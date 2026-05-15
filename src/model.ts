import OpenAI from "openai";
import type { AppConfig } from "./types";
import { ensureOpenAIBaseUrl } from "./provider";

export type OpenAIServerModelOptions = {
  modelId: string;
  apiKey: string;
  baseURL?: string;
  temperature?: number;
  maxTokens?: number;
};

/** OpenAI-compatible chat（OpenAI / Ollama / DeepSeek / vLLM …）。 */
export class OpenAIServerModel {
  readonly modelId: string;
  readonly client: OpenAI;
  readonly temperature: number;
  readonly maxTokens: number;

  constructor(opts: OpenAIServerModelOptions) {
    this.modelId = opts.modelId;
    this.temperature = opts.temperature ?? 0.2;
    this.maxTokens = opts.maxTokens ?? 4096;
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: ensureOpenAIBaseUrl(opts.baseURL ?? "https://api.openai.com/v1")
    });
  }

  static fromAppConfig(config: AppConfig): OpenAIServerModel {
    if (config.activeProvider === "ollama") {
      const o = config.providers.ollama;
      return new OpenAIServerModel({
        modelId: o.model,
        apiKey: "ollama",
        baseURL: ensureOpenAIBaseUrl(o.baseUrl ?? "http://127.0.0.1:11434"),
        temperature: o.temperature,
        maxTokens: o.maxTokens
      });
    }
    const d = config.providers.deepseek;
    return new OpenAIServerModel({
      modelId: d.model,
      apiKey: d.apiKey,
      baseURL: ensureOpenAIBaseUrl(d.baseUrl ?? "https://api.deepseek.com/v1"),
      temperature: d.temperature,
      maxTokens: d.maxTokens
    });
  }
}
