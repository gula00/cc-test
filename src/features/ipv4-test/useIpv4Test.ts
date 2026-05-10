import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { fetchModelsForConfig, type FetchedModel } from "@/lib/api/model-fetch";
import {
  getStreamCheckConfig,
  testIpv4CodexPrompt,
  type StreamCheckConfig,
} from "@/lib/api/model-test";
import { providersApi } from "@/lib/api/providers";
import {
  buildIpv4CodexProvider,
  buildIpv4GeminiProvider,
} from "@/features/ipv4-test/providerBuilders";
import {
  pickReplyTestModel,
  shouldApplyToGemini,
} from "@/features/ipv4-test/modelSelection";
import type { TFunction } from "i18next";

const FIXED_PORT = 8317;

const IPV4_PATTERN =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

function isValidIpv4(value: string): boolean {
  return IPV4_PATTERN.test(value.trim());
}

function extractCodexApiKey(settings: unknown): string {
  if (!settings || typeof settings !== "object") return "";
  const auth = (settings as { auth?: unknown }).auth;
  if (!auth || typeof auth !== "object") return "";
  const apiKey = (auth as { OPENAI_API_KEY?: unknown }).OPENAI_API_KEY;
  return typeof apiKey === "string" ? apiKey.trim() : "";
}

export function useIpv4Test(t: TFunction) {
  const [ipv4, setIpv4] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const [isTestingReply, setIsTestingReply] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<FetchedModel[]>([]);
  const [streamCheckConfig, setStreamCheckConfig] =
    useState<StreamCheckConfig | null>(null);
  const [replyResult, setReplyResult] = useState<{
    modelUsed: string;
    responseText: string;
    testedIpv4: string;
  } | null>(null);
  const [isApplyingConfig, setIsApplyingConfig] = useState(false);
  const [appliedIpv4, setAppliedIpv4] = useState<string | null>(null);
  const [selectedTestModel, setSelectedTestModel] = useState<string | null>(null);
  const latestRequestId = useRef(0);

  useEffect(() => {
    let cancelled = false;

    async function loadDefaults() {
      try {
        setIsBootstrapping(true);
        setError(null);
        const [liveSettings, config] = await Promise.all([
          providersApi.readLiveSettings("codex"),
          getStreamCheckConfig(),
        ]);

        if (cancelled) return;
        setApiKey(extractCodexApiKey(liveSettings));
        setStreamCheckConfig(config);
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
        }
      } finally {
        if (!cancelled) {
          setIsBootstrapping(false);
        }
      }
    }

    void loadDefaults();

    return () => {
      cancelled = true;
    };
  }, []);

  const trimmedIpv4 = ipv4.trim();
  const isIpv4Ready = isValidIpv4(trimmedIpv4);
  const canFetch = isIpv4Ready && Boolean(apiKey);
  const applyTargetApp = replyResult
    ? shouldApplyToGemini(replyResult.modelUsed, models)
      ? "gemini"
      : "codex"
    : "codex";
  const applyTargetLabel = applyTargetApp === "gemini" ? "Gemini" : "Codex";

  const statusText = useMemo(() => {
    if (!apiKey) return t("streamCheck.ipv4KeyMissing");
    return t("streamCheck.ipv4UsingCurrentConfig", { port: FIXED_PORT });
  }, [apiKey, t]);

  const requestModels = async (targetIpv4: string) => {
    return fetchModelsForConfig(`http://${targetIpv4}:${FIXED_PORT}`, apiKey);
  };

  const runFetch = async (targetIpv4: string) => {
    if (!apiKey) return;

    const requestId = ++latestRequestId.current;
    setIsLoading(true);
    setError(null);

    try {
      const result = await requestModels(targetIpv4);

      if (latestRequestId.current !== requestId) return;

      setModels(result);
      setSelectedTestModel((current) =>
        current && result.some((model) => model.id === current) ? current : null,
      );
      if (result.length === 0) {
        setError(t("streamCheck.ipv4NoModels"));
      }
    } catch (err) {
      if (latestRequestId.current !== requestId) return;
      setModels([]);
      setError(String(err));
    } finally {
      if (latestRequestId.current === requestId) {
        setIsLoading(false);
      }
    }
  };

  const runReplyTest = async () => {
    if (!canFetch || !streamCheckConfig) return;

    setIsTestingReply(true);
    setError(null);
    try {
      const overrideModel =
        selectedTestModel || pickReplyTestModel(models, streamCheckConfig.codexModel);
      const result = await testIpv4CodexPrompt(
        trimmedIpv4,
        apiKey,
        streamCheckConfig,
        overrideModel,
      );
      setReplyResult({ ...result, testedIpv4: trimmedIpv4 });
    } catch (err) {
      setError(String(err));
    } finally {
      setIsTestingReply(false);
    }
  };

  const applyConfig = async () => {
    if (
      !replyResult ||
      !streamCheckConfig ||
      !trimmedIpv4 ||
      !apiKey ||
      replyResult.testedIpv4 !== trimmedIpv4
    ) {
      return;
    }

    setIsApplyingConfig(true);

    try {
      const existingProviders = await providersApi.getAll(applyTargetApp);
      const duplicate = Object.values(existingProviders).some(
        (provider) => provider.name.trim() === trimmedIpv4,
      );

      if (duplicate) {
        toast.error(
          t("streamCheck.ipv4ApplyDuplicate", {
            ipv4: trimmedIpv4,
            target: applyTargetLabel,
          }),
        );
        return;
      }

      const provider =
        applyTargetApp === "gemini"
          ? buildIpv4GeminiProvider(trimmedIpv4, apiKey, replyResult.modelUsed)
          : buildIpv4CodexProvider(trimmedIpv4, apiKey);
      await providersApi.addInactive(provider, applyTargetApp);
      setAppliedIpv4(trimmedIpv4);
      toast.success(
        t("streamCheck.ipv4ApplySuccess", {
          ipv4: trimmedIpv4,
          target: applyTargetLabel,
        }),
        {
          description: t("streamCheck.ipv4ApplySuccessDescription", {
            target: applyTargetLabel,
          }),
          closeButton: true,
        },
      );
    } catch (err) {
      toast.error(t("streamCheck.ipv4ApplyFailed", { target: applyTargetLabel }), {
        description: String(err),
      });
    } finally {
      setIsApplyingConfig(false);
    }
  };

  useEffect(() => {
    if (!replyResult) {
      return;
    }

    setAppliedIpv4((current) => (current === trimmedIpv4 ? current : null));
  }, [replyResult, trimmedIpv4]);

  useEffect(() => {
    if (!canFetch) {
      setModels([]);
      setIsLoading(false);
      setAppliedIpv4(null);
      setSelectedTestModel(null);
      return;
    }

    const timer = window.setTimeout(() => {
      void runFetch(trimmedIpv4);
    }, 450);

    return () => {
      window.clearTimeout(timer);
    };
  }, [apiKey, canFetch, trimmedIpv4]);

  return {
    FIXED_PORT,
    apiKey,
    ipv4,
    setIpv4,
    trimmedIpv4,
    isBootstrapping,
    isLoading,
    isTestingReply,
    isApplyingConfig,
    error,
    models,
    streamCheckConfig,
    replyResult,
    appliedIpv4,
    selectedTestModel,
    setSelectedTestModel,
    isIpv4Ready,
    canFetch,
    statusText,
    applyTargetLabel,
    runFetch,
    runReplyTest,
    applyConfig,
    clearTransientState: () => {
      setAppliedIpv4(null);
      setSelectedTestModel(null);
      setError(null);
    },
    clearFeedbackState: () => {
      setAppliedIpv4(null);
      setError(null);
    },
  };
}
