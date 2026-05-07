import { invoke } from "@tauri-apps/api/core";
import type { AppId } from "./types";

// ===== 流式健康检查类型 =====

export type HealthStatus = "operational" | "degraded" | "failed";

export interface StreamCheckConfig {
  timeoutSecs: number;
  maxRetries: number;
  degradedThresholdMs: number;
  claudeModel: string;
  codexModel: string;
  geminiModel: string;
  testPrompt: string;
}

export interface StreamCheckResult {
  status: HealthStatus;
  success: boolean;
  message: string;
  responseTimeMs?: number;
  httpStatus?: number;
  modelUsed: string;
  testedAt: number;
  retryCount: number;
  /** 细粒度错误分类，如 "modelNotFound" */
  errorCategory?: string;
}

export interface Ipv4CodexPromptTestResult {
  modelUsed: string;
  responseText: string;
}

export interface ProviderPromptTestResult {
  modelUsed: string;
  responseText: string;
  responseTimeMs?: number;
  message?: string;
}

// ===== 流式健康检查 API =====

/**
 * 流式健康检查（单个供应商）
 */
export async function streamCheckProvider(
  appType: AppId,
  providerId: string,
  overrideModel?: string,
): Promise<StreamCheckResult> {
  return invoke("stream_check_provider", { appType, providerId, overrideModel });
}

/**
 * 批量流式健康检查
 */
export async function streamCheckAllProviders(
  appType: AppId,
  proxyTargetsOnly: boolean = false,
): Promise<Array<[string, StreamCheckResult]>> {
  return invoke("stream_check_all_providers", { appType, proxyTargetsOnly });
}

/**
 * 获取流式检查配置
 */
export async function getStreamCheckConfig(): Promise<StreamCheckConfig> {
  return invoke("get_stream_check_config");
}

/**
 * 保存流式检查配置
 */
export async function saveStreamCheckConfig(
  config: StreamCheckConfig,
): Promise<void> {
  return invoke("save_stream_check_config", { config });
}

export async function testIpv4CodexPrompt(
  ipv4: string,
  apiKey: string,
  config: StreamCheckConfig,
  overrideModel?: string,
): Promise<Ipv4CodexPromptTestResult> {
  return invoke("test_ipv4_codex_prompt", {
    ipv4,
    apiKey,
    config,
    overrideModel,
  });
}

export async function testProviderPrompt(
  appType: AppId,
  providerId: string,
  overrideModel?: string,
): Promise<ProviderPromptTestResult> {
  return invoke("test_provider_prompt", {
    appType,
    providerId,
    overrideModel,
  });
}
