import { useTranslation } from "react-i18next";
import { AlertCircle, CheckCircle2, Loader2, Network, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useIpv4Test } from "@/features/ipv4-test/useIpv4Test";

export function Ipv4TestPanel() {
  const { t } = useTranslation();
  const {
    FIXED_PORT,
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
    clearTransientState,
    clearFeedbackState,
  } = useIpv4Test(t);

  const applyButtonLabel = t("streamCheck.ipv4ApplyButton", {
    target: applyTargetLabel,
  });
  const applyHintText = t("streamCheck.ipv4ApplyHint", {
    target: applyTargetLabel,
  });
  const isReplyForCurrentIpv4 =
    !!replyResult && replyResult.testedIpv4 === trimmedIpv4;

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
              clearTransientState();
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
            {t("streamCheck.ipv4ReplyResultLabel")} ·{" "}
            {t("streamCheck.ipv4MeasuredModel", {
              model: replyResult.modelUsed,
              defaultValue: "测得模型：{{model}}",
            })}
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
            disabled={
              isApplyingConfig || appliedIpv4 === trimmedIpv4 || !isReplyForCurrentIpv4
            }
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
          <p className="text-xs text-muted-foreground">{applyHintText}</p>
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
                    clearFeedbackState();
                    setSelectedTestModel((current) =>
                      current === model.id ? null : model.id,
                    );
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
