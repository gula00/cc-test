import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, Loader2, Network, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { generateThirdPartyAuth, generateThirdPartyConfig } from "@/config/codexProviderPresets";
import { fetchModelsForConfig, type FetchedModel } from "@/lib/api/model-fetch";
import {
  getStreamCheckConfig,
  testIpv4CodexPrompt,
  type StreamCheckConfig,
} from "@/lib/api/model-test";
import { providersApi } from "@/lib/api/providers";
import { generateUUID } from "@/utils/uuid";
import type { Provider } from "@/types";

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

function parseCodexModelWithEffort(model: string): {
  modelName: string;
  reasoningEffort: string;
} {
  const trimmed = model.trim();
  if (!trimmed) {
    return {
      modelName: "gpt-5.4",
      reasoningEffort: "high",
    };
  }

  const separatorIndex = [...["@","#"]]
    .map((separator) => trimmed.indexOf(separator))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b)[0];

  if (separatorIndex === undefined) {
    return {
      modelName: trimmed,
      reasoningEffort: "high",
    };
  }

  const modelName = trimmed.slice(0, separatorIndex).trim() || "gpt-5.4";
  const reasoningEffort = trimmed.slice(separatorIndex + 1).trim() || "high";
  return { modelName, reasoningEffort };
}

function buildIpv4CodexProvider(
  ipv4: string,
  apiKey: string,
  config: StreamCheckConfig,
): Provider {
  const { modelName, reasoningEffort } = parseCodexModelWithEffort(config.codexModel);
  const baseUrl = `http://${ipv4}:${FIXED_PORT}/v1`;
  const generatedConfig = generateThirdPartyConfig(ipv4, baseUrl, modelName).replace(
    /model_reasoning_effort = ".*?"/,
    `model_reasoning_effort = "${reasoningEffort}"`,
  );

  return {
    id: `codex-ipv4-${generateUUID()}`,
    name: ipv4,
    category: "custom",
    createdAt: Date.now(),
    settingsConfig: {
      auth: generateThirdPartyAuth(apiKey),
      config: generatedConfig,
    },
  };
}

function buildIpv4GeminiProvider(
  ipv4: string,
  apiKey: string,
  modelName: string,
): Provider {
  return {
    id: `gemini-ipv4-${generateUUID()}`,
    name: ipv4,
    category: "custom",
    createdAt: Date.now(),
    settingsConfig: {
      env: {
        GOOGLE_GEMINI_BASE_URL: `http://${ipv4}:${FIXED_PORT}`,
        GEMINI_API_KEY: apiKey,
        GEMINI_MODEL: modelName,
      },
    },
  };
}

function hasExactGpt54Model(model: FetchedModel): boolean {
  return model.id.trim().toLowerCase() === "gpt-5.4";
}

function isGoogleLikeModel(model: FetchedModel): boolean {
  const id = model.id.toLowerCase();
  const owner = (model.ownedBy || "").toLowerCase();
  return (
    owner.includes("google") ||
    owner.includes("antigravity") ||
    id.includes("google") ||
    id.includes("gemini") ||
    id.includes("gemma")
  );
}

function pickReplyTestModel(
  fetchedModels: FetchedModel[],
  configuredModel: string,
): string | undefined {
  if (fetchedModels.length === 0) {
    return undefined;
  }

  if (fetchedModels.some(hasExactGpt54Model)) {
    return undefined;
  }

  return fetchedModels.find(isGoogleLikeModel)?.id || configuredModel;
}

function shouldApplyToGemini(
  testedModel: string,
  fetchedModels: FetchedModel[],
): boolean {
  const matchedModel = fetchedModels.find((model) => model.id === testedModel);
  return matchedModel ? isGoogleLikeModel(matchedModel) : false;
}

export function Ipv4ModelFetchPanel() {
  const { t } = useTranslation();
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
    setReplyResult(null);

    try {
      const overrideModel =
        selectedTestModel || pickReplyTestModel(models, streamCheckConfig.codexModel);
      const result = await testIpv4CodexPrompt(
        trimmedIpv4,
        apiKey,
        streamCheckConfig,
        overrideModel,
      );
      setReplyResult(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsTestingReply(false);
    }
  };

  const applyConfig = async () => {
    if (!replyResult || !streamCheckConfig || !trimmedIpv4 || !apiKey) return;

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
          : buildIpv4CodexProvider(trimmedIpv4, apiKey, streamCheckConfig);
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

  const applyButtonLabel = t("streamCheck.ipv4ApplyButton", {
    target: applyTargetLabel,
  });
  const applyHintText = t("streamCheck.ipv4ApplyHint", {
    target: applyTargetLabel,
  });

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
      setReplyResult(null);
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

  return (
    <div className="space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Network className="h-4 w-4 text-sky-500" />
            <h4 className="text-sm font-medium">{t("streamCheck.ipv4Title")}</h4>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("streamCheck.ipv4Description")}
          </p>
        </div>
        <Badge variant="secondary">
          {t("streamCheck.ipv4PortBadge", { port: FIXED_PORT })}
        </Badge>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ipv4-model-fetch">{t("streamCheck.ipv4InputLabel")}</Label>
        <div className="flex gap-2">
          <Input
            id="ipv4-model-fetch"
            value={ipv4}
            onChange={(e) => {
              setIpv4(e.target.value);
              setReplyResult(null);
              setAppliedIpv4(null);
              setSelectedTestModel(null);
              setError(null);
            }}
            placeholder={t("streamCheck.ipv4Placeholder")}
            autoComplete="off"
            spellCheck={false}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!canFetch || isLoading}
            onClick={() => void runFetch(trimmedIpv4)}
            title={t("streamCheck.ipv4Retry")}
          >
            {isLoading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!canFetch || !streamCheckConfig || isTestingReply}
            onClick={() => void runReplyTest()}
          >
            {isTestingReply ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("streamCheck.ipv4ReplyTesting")}
              </>
            ) : (
              t("streamCheck.ipv4ReplyButton")
            )}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">{statusText}</p>
        {streamCheckConfig ? (
          <p className="text-xs text-muted-foreground">
            {t("streamCheck.ipv4ReplyConfigHint", {
              model: streamCheckConfig.codexModel,
              prompt: streamCheckConfig.testPrompt,
            })}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground">
          {selectedTestModel
            ? t("streamCheck.ipv4SelectedModel", { model: selectedTestModel })
            : t("streamCheck.ipv4SelectedModelAuto")}
        </p>
      </div>

      {!isBootstrapping && trimmedIpv4 && !isIpv4Ready ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{t("streamCheck.ipv4Invalid")}</AlertDescription>
        </Alert>
      ) : null}

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {replyResult ? (
        <Alert>
          <CheckCircle2 className="h-4 w-4 text-green-500" />
          <AlertDescription>
            {t("streamCheck.ipv4ReplySuccess", { model: replyResult.modelUsed })}
          </AlertDescription>
        </Alert>
      ) : null}

      {replyResult ? (
        <div className="space-y-2 rounded-md border border-border/60 bg-background p-3">
          <div className="text-xs font-medium text-muted-foreground">
            {t("streamCheck.ipv4ReplyResultLabel")}
          </div>
          <div className="whitespace-pre-wrap break-words text-sm">
            {replyResult.responseText}
          </div>
        </div>
      ) : null}

      {replyResult ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            disabled={isApplyingConfig || appliedIpv4 === trimmedIpv4}
            onClick={() => void applyConfig()}
          >
            {isApplyingConfig ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("streamCheck.ipv4Applying")}
              </>
            ) : appliedIpv4 === trimmedIpv4 ? (
              t("streamCheck.ipv4Applied")
            ) : (
              applyButtonLabel
            )}
          </Button>
          <p className="text-xs text-muted-foreground">
            {applyHintText}
          </p>
        </div>
      ) : null}

      {models.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span>{t("streamCheck.ipv4ResultCount", { count: models.length })}</span>
          </div>
          <div className="max-h-64 overflow-y-auto rounded-md border border-border/60 bg-background">
            <div className="divide-y divide-border/50">
              {models.map((model) => (
                <div
                  key={model.id}
                  className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm transition-colors ${
                    selectedTestModel === model.id
                      ? "bg-sky-50 dark:bg-sky-950/30"
                      : "hover:bg-muted/40"
                  }`}
                  onClick={() => {
                    setSelectedTestModel((current) =>
                      current === model.id ? null : model.id,
                    );
                    setReplyResult(null);
                    setAppliedIpv4(null);
                    setError(null);
                  }}
                >
                  <span className="break-all font-mono text-xs">{model.id}</span>
                  <div className="flex items-center gap-2">
                    {selectedTestModel === model.id ? (
                      <Badge variant="secondary" className="shrink-0">
                        {t("streamCheck.ipv4SelectedBadge")}
                      </Badge>
                    ) : null}
                    {model.ownedBy ? (
                      <Badge variant="outline" className="shrink-0">
                        {model.ownedBy}
                      </Badge>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
