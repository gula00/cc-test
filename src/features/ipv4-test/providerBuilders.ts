import { generateThirdPartyAuth } from "@/config/codexProviderPresets";
import { generateUUID } from "@/utils/uuid";
import type { Provider } from "@/types";

const FIXED_PORT = 8317;

function buildIpv4CodexConfig(ipv4: string): string {
  const baseUrl = `http://${ipv4}:${FIXED_PORT}/v1`;
  return `model_provider = "cliproxyapi"
model = "gpt-5.5"
model_reasoning_effort = "medium"
disable_response_storage = true

[model_providers.cliproxyapi]
name = "${ipv4}"
base_url = "${baseUrl}"
wire_api = "responses"
requires_openai_auth = true

[windows]
sandbox = "elevated"

[features]
goals = true`;
}

export function buildIpv4CodexProvider(ipv4: string, apiKey: string): Provider {
  return {
    id: `codex-ipv4-${generateUUID()}`,
    name: ipv4,
    category: "custom",
    createdAt: Date.now(),
    settingsConfig: {
      auth: generateThirdPartyAuth(apiKey),
      config: buildIpv4CodexConfig(ipv4),
    },
  };
}

export function buildIpv4GeminiProvider(
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
