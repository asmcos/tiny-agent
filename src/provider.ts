import OpenAI from "openai";
import type { AppConfig } from "./types";

export interface ProviderRuntime {
  client: OpenAI;
  model: string;
  temperature: number;
  maxTokens?: number;
}

/** OpenAI-compatible base URL: ensure trailing `/v1`. */
export function ensureOpenAIBaseUrl(baseUrl: string): string {
  const cleaned = baseUrl.replace(/\/+$/, "");
  return cleaned.endsWith("/v1") ? cleaned : `${cleaned}/v1`;
}

/** Live API from `config.json` (`activeProvider` + `providers`). */
export function createProviderRuntime(config: AppConfig): ProviderRuntime {
  const provider = config.activeProvider;
  if (provider === "ollama") {
    const p = config.providers.ollama;
    return {
      client: new OpenAI({
        apiKey: "ollama",
        baseURL: ensureOpenAIBaseUrl(p.baseUrl ?? "http://127.0.0.1:11434")
      }),
      model: p.model,
      temperature: p.temperature ?? 0.1,
      maxTokens: p.maxTokens
    };
  }

  const p = config.providers.deepseek;
  return {
    client: new OpenAI({
      apiKey: p.apiKey,
      baseURL: ensureOpenAIBaseUrl(p.baseUrl ?? "https://api.deepseek.com/v1")
    }),
    model: p.model,
    temperature: p.temperature ?? 0.1,
    maxTokens: p.maxTokens
  };
}
