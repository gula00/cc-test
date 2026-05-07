import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  Coins,
  FlaskConical,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ProviderTestConfig } from "@/types";
import type { FetchedModel } from "@/lib/api/model-fetch";
import { streamCheckProvider, type StreamCheckResult } from "@/lib/api/model-test";
import type { AppId } from "@/lib/api";

export type PricingModelSourceOption = "inherit" | "request" | "response";

interface ProviderPricingConfig {
  enabled: boolean;
  costMultiplier?: string;
  pricingModelSource: PricingModelSourceOption;
}

interface ProviderAdvancedConfigProps {
  appId: AppId;
  providerId?: string;
  providerName?: string;
  testConfig: ProviderTestConfig;
  pricingConfig: ProviderPricingConfig;
  availableModels?: FetchedModel[];
  onTestConfigChange: (config: ProviderTestConfig) => void;
  onPricingConfigChange: (config: ProviderPricingConfig) => void;
}

export function ProviderAdvancedConfig({
  appId,
  providerId,
  providerName,
  testConfig,
  pricingConfig,
  availableModels = [],
  onTestConfigChange,
  onPricingConfigChange,
}: ProviderAdvancedConfigProps) {
  const { t } = useTranslation();
  const [isTestConfigOpen, setIsTestConfigOpen] = useState(testConfig.enabled);
  const [isPricingConfigOpen, setIsPricingConfigOpen] = useState(
    pricingConfig.enabled,
  );
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<StreamCheckResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    setIsTestConfigOpen(testConfig.enabled);
  }, [testConfig.enabled]);

  useEffect(() => {
    setIsPricingConfigOpen(pricingConfig.enabled);
  }, [pricingConfig.enabled]);

  const selectedTestModel = testConfig.testModel?.trim() || "";

  const handleTestReturn = async () => {
    if (!providerId || isTesting) return;

    setIsTesting(true);
    setTestResult(null);
    setTestError(null);

    try {
      const result = await streamCheckProvider(
        appId,
        providerId,
        selectedTestModel || undefined,
      );
      setTestResult(result);
      if (!result.success) {
        setTestError(result.message);
      }
    } catch (error) {
      setTestError(String(error));
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border/50 bg-muted/20">
        <button
          type="button"
          className="flex w-full items-center justify-between p-4 hover:bg-muted/30 transition-colors"
          onClick={() => setIsTestConfigOpen(!isTestConfigOpen)}
        >
          <div className="flex items-center gap-3">
            <FlaskConical className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">
              {t("providerAdvanced.testConfig", {
                defaultValue: "模型测试配置",
              })}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div
              className="flex items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <Label
                htmlFor="test-config-enabled"
                className="text-sm text-muted-foreground"
              >
                {t("providerAdvanced.useCustomConfig", {
                  defaultValue: "使用单独配置",
                })}
              </Label>
              <Switch
                id="test-config-enabled"
                checked={testConfig.enabled}
                onCheckedChange={(checked) => {
                  onTestConfigChange({ ...testConfig, enabled: checked });
                  if (checked) setIsTestConfigOpen(true);
                }}
              />
            </div>
            {isTestConfigOpen ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>
        <div
          className={cn(
            "overflow-hidden transition-all duration-200",
            isTestConfigOpen
              ? "max-h-[900px] opacity-100"
              : "max-h-0 opacity-0",
          )}
        >
          <div className="border-t border-border/50 p-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("providerAdvanced.testConfigDesc", {
                defaultValue:
                  "为此供应商配置单独的模型测试参数，不启用时使用全局配置。",
              })}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="test-model">
                  {t("providerAdvanced.testModel", {
                    defaultValue: "测试模型",
                  })}
                </Label>
                <Input
                  id="test-model"
                  value={testConfig.testModel || ""}
                  onChange={(e) =>
                    onTestConfigChange({
                      ...testConfig,
                      testModel: e.target.value || undefined,
                    })
                  }
                  placeholder={t("providerAdvanced.testModelPlaceholder", {
                    defaultValue: "留空使用全局配置",
                  })}
                  disabled={!testConfig.enabled}
                />
                <p className="text-xs text-muted-foreground">
                  {selectedTestModel
                    ? t("providerAdvanced.selectedTestModel", {
                        model: selectedTestModel,
                        defaultValue: "当前选择：{{model}}",
                      })
                    : t("providerAdvanced.selectedTestModelAuto", {
                        defaultValue: "当前选择：自动",
                      })}
                </p>
                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-8"
                    onClick={handleTestReturn}
                    disabled={!providerId || isTesting}
                    title={
                      providerId
                        ? undefined
                        : t("providerAdvanced.testReturnNeedSave", {
                            defaultValue: "保存供应商后才能测试",
                          })
                    }
                  >
                    {isTesting && (
                      <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                    )}
                    {t("providerAdvanced.testReturn", {
                      defaultValue: "测试返回",
                    })}
                  </Button>
                  {(testResult || testError) && (
                    <div
                      className={cn(
                        "rounded-md border px-3 py-2 text-xs",
                        testResult?.success
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                          : "border-destructive/30 bg-destructive/10 text-destructive",
                      )}
                    >
                      {testResult?.success
                        ? t("providerAdvanced.testReturnSuccess", {
                            providerName:
                              providerName ||
                              t("providerAdvanced.thisProvider", {
                                defaultValue: "此供应商",
                              }),
                            model: testResult.modelUsed,
                            responseTimeMs: testResult.responseTimeMs,
                            defaultValue:
                              "{{providerName}} 返回成功：{{model}} ({{responseTimeMs}}ms)",
                          })
                        : t("providerAdvanced.testReturnFailed", {
                            message: testError || testResult?.message || "",
                            defaultValue: "测试失败：{{message}}",
                          })}
                    </div>
                  )}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="test-timeout">
                  {t("providerAdvanced.timeoutSecs", {
                    defaultValue: "超时时间（秒）",
                  })}
                </Label>
                <Input
                  id="test-timeout"
                  type="number"
                  min={1}
                  max={300}
                  value={testConfig.timeoutSecs || ""}
                  onChange={(e) =>
                    onTestConfigChange({
                      ...testConfig,
                      timeoutSecs: e.target.value
                        ? parseInt(e.target.value, 10)
                        : undefined,
                    })
                  }
                  placeholder="45"
                  disabled={!testConfig.enabled}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="test-prompt">
                  {t("providerAdvanced.testPrompt", {
                    defaultValue: "测试提示词",
                  })}
                </Label>
                <Input
                  id="test-prompt"
                  value={testConfig.testPrompt || ""}
                  onChange={(e) =>
                    onTestConfigChange({
                      ...testConfig,
                      testPrompt: e.target.value || undefined,
                    })
                  }
                  placeholder="Who are you?"
                  disabled={!testConfig.enabled}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="degraded-threshold">
                  {t("providerAdvanced.degradedThreshold", {
                    defaultValue: "降级阈值（毫秒）",
                  })}
                </Label>
                <Input
                  id="degraded-threshold"
                  type="number"
                  min={100}
                  max={60000}
                  value={testConfig.degradedThresholdMs || ""}
                  onChange={(e) =>
                    onTestConfigChange({
                      ...testConfig,
                      degradedThresholdMs: e.target.value
                        ? parseInt(e.target.value, 10)
                        : undefined,
                    })
                  }
                  placeholder="6000"
                  disabled={!testConfig.enabled}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="max-retries">
                  {t("providerAdvanced.maxRetries", {
                    defaultValue: "最大重试次数",
                  })}
                </Label>
                <Input
                  id="max-retries"
                  type="number"
                  min={0}
                  max={10}
                  value={testConfig.maxRetries ?? ""}
                  onChange={(e) =>
                    onTestConfigChange({
                      ...testConfig,
                      maxRetries: e.target.value
                        ? parseInt(e.target.value, 10)
                        : undefined,
                    })
                  }
                  placeholder="2"
                  disabled={!testConfig.enabled}
                />
              </div>
            </div>
            {availableModels.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <Label>
                      {t("providerAdvanced.availableModels", {
                        defaultValue: "可用模型列表",
                      })}
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {t("providerAdvanced.availableModelsHint", {
                        defaultValue:
                          "点击模型会设置为此供应商的测试模型，保存后列表里的测试会使用它。",
                      })}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0">
                    {t("providerAdvanced.availableModelsCount", {
                      count: availableModels.length,
                      defaultValue: "{{count}} 个模型",
                    })}
                  </Badge>
                </div>
                <div className="grid max-h-80 grid-cols-1 gap-2 overflow-y-auto rounded-lg border bg-background p-2 md:grid-cols-2 xl:grid-cols-3">
                  {availableModels.map((model) => {
                    const isSelected = selectedTestModel === model.id;
                    return (
                      <button
                        key={`${model.ownedBy ?? "unknown"}:${model.id}`}
                        type="button"
                        className={cn(
                          "flex min-h-16 w-full flex-col items-start justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-muted/50",
                          isSelected &&
                            "border-primary/50 bg-primary/10 hover:bg-primary/10",
                        )}
                        onClick={() => {
                          onTestConfigChange({
                            ...testConfig,
                            enabled: true,
                            testModel: isSelected ? undefined : model.id,
                          });
                          setIsTestConfigOpen(true);
                        }}
                      >
                        <span className="w-full truncate font-medium">
                          {model.id}
                        </span>
                        <span className="flex w-full items-center gap-2">
                          {model.ownedBy && (
                            <Badge
                              variant="outline"
                              className="max-w-32 truncate text-[10px]"
                            >
                              {model.ownedBy}
                            </Badge>
                          )}
                          {isSelected && (
                            <Badge variant="secondary" className="text-[10px]">
                              {t("providerAdvanced.selected", {
                                defaultValue: "已选择",
                              })}
                            </Badge>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 计费配置 */}
      <div className="rounded-lg border border-border/50 bg-muted/20">
        <button
          type="button"
          className="flex w-full items-center justify-between p-4 hover:bg-muted/30 transition-colors"
          onClick={() => setIsPricingConfigOpen(!isPricingConfigOpen)}
        >
          <div className="flex items-center gap-3">
            <Coins className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">
              {t("providerAdvanced.pricingConfig", {
                defaultValue: "计费配置",
              })}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div
              className="flex items-center gap-2"
              onClick={(e) => e.stopPropagation()}
            >
              <Label
                htmlFor="pricing-config-enabled"
                className="text-sm text-muted-foreground"
              >
                {t("providerAdvanced.useCustomPricing", {
                  defaultValue: "使用单独配置",
                })}
              </Label>
              <Switch
                id="pricing-config-enabled"
                checked={pricingConfig.enabled}
                onCheckedChange={(checked) => {
                  onPricingConfigChange({ ...pricingConfig, enabled: checked });
                  if (checked) setIsPricingConfigOpen(true);
                }}
              />
            </div>
            {isPricingConfigOpen ? (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>
        <div
          className={cn(
            "overflow-hidden transition-all duration-200",
            isPricingConfigOpen
              ? "max-h-[500px] opacity-100"
              : "max-h-0 opacity-0",
          )}
        >
          <div className="border-t border-border/50 p-4 space-y-4">
            <p className="text-sm text-muted-foreground">
              {t("providerAdvanced.pricingConfigDesc", {
                defaultValue:
                  "为此供应商配置单独的计费参数，不启用时使用全局默认配置。",
              })}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="cost-multiplier">
                  {t("providerAdvanced.costMultiplier", {
                    defaultValue: "成本倍率",
                  })}
                </Label>
                <Input
                  id="cost-multiplier"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={pricingConfig.costMultiplier || ""}
                  onChange={(e) =>
                    onPricingConfigChange({
                      ...pricingConfig,
                      costMultiplier: e.target.value || undefined,
                    })
                  }
                  placeholder={t("providerAdvanced.costMultiplierPlaceholder", {
                    defaultValue: "留空使用全局默认（1）",
                  })}
                  disabled={!pricingConfig.enabled}
                />
                <p className="text-xs text-muted-foreground">
                  {t("providerAdvanced.costMultiplierHint", {
                    defaultValue: "实际成本 = 基础成本 × 倍率，支持小数如 1.5",
                  })}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="pricing-model-source">
                  {t("providerAdvanced.pricingModelSourceLabel", {
                    defaultValue: "计费模式",
                  })}
                </Label>
                <Select
                  value={pricingConfig.pricingModelSource}
                  onValueChange={(value) =>
                    onPricingConfigChange({
                      ...pricingConfig,
                      pricingModelSource: value as PricingModelSourceOption,
                    })
                  }
                  disabled={!pricingConfig.enabled}
                >
                  <SelectTrigger id="pricing-model-source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="inherit">
                      {t("providerAdvanced.pricingModelSourceInherit", {
                        defaultValue: "继承全局默认",
                      })}
                    </SelectItem>
                    <SelectItem value="request">
                      {t("providerAdvanced.pricingModelSourceRequest", {
                        defaultValue: "请求模型",
                      })}
                    </SelectItem>
                    <SelectItem value="response">
                      {t("providerAdvanced.pricingModelSourceResponse", {
                        defaultValue: "返回模型",
                      })}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  {t("providerAdvanced.pricingModelSourceHint", {
                    defaultValue: "选择按请求模型还是返回模型进行定价匹配",
                  })}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
