import path from "node:path";
import { pathToFileURL } from "node:url";
import OpenAI from "openai";
import { AppConfig } from "./types";

function isMockLlmEnabled(): boolean {
  const v = process.env.TINY_AGENT_MOCK_LLM?.trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

/** Lazy `import()` of a module that exports `createMockLlmFetch(): typeof fetch` (e.g. under `examples/`). */
function createLazyLoadedMockFetch(resolvedModulePath: string): typeof fetch {
  let innerPromise: Promise<typeof fetch> | null = null;
  const ensure = (): Promise<typeof fetch> => {
    if (!innerPromise) {
      const href = pathToFileURL(resolvedModulePath).href;
      innerPromise = import(href).then((m: { createMockLlmFetch?: () => typeof fetch }) => {
        const factory = m.createMockLlmFetch;
        if (typeof factory !== "function") {
          throw new Error(
            `TINY_AGENT_MOCK_LLM_MODULE: ${resolvedModulePath} must export function createMockLlmFetch()`
          );
        }
        return factory();
      });
    }
    return innerPromise;
  };
  return (url, init) => ensure().then((fn) => fn(url, init));
}

export interface ProviderRuntime {
  client: OpenAI;
  model: string;
  temperature: number;
  maxTokens?: number;
}

function ensureOpenAIBaseUrl(baseUrl: string): string {
  const cleaned = baseUrl.replace(/\/+$/, "");
  return cleaned.endsWith("/v1") ? cleaned : `${cleaned}/v1`;
}

export function createProviderRuntime(config: AppConfig): ProviderRuntime {
  if (isMockLlmEnabled()) {
    const p = config.providers.deepseek;
    const customMod = process.env.TINY_AGENT_MOCK_LLM_MODULE?.trim();
    if (!customMod) {
      throw new Error(
        "TINY_AGENT_MOCK_LLM=1 requires TINY_AGENT_MOCK_LLM_MODULE pointing to a file that exports " +
          "createMockLlmFetch() (e.g. examples/agent-mocks/genericMockLlmFetch.ts)."
      );
    }
    const mockFetch = createLazyLoadedMockFetch(
      path.isAbsolute(customMod) ? customMod : path.resolve(process.cwd(), customMod)
    );
    return {
      client: new OpenAI({
        apiKey: p.apiKey || "mock",
        baseURL: p.baseUrl ?? "https://api.deepseek.com/v1",
        fetch: mockFetch
      }),
      model: `${p.model}-mock`,
      temperature: p.temperature ?? 0.1,
      maxTokens: p.maxTokens
    };
  }

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
      baseURL: p.baseUrl ?? "https://api.deepseek.com/v1"
    }),
    model: p.model,
    temperature: p.temperature ?? 0.1,
    maxTokens: p.maxTokens
  };
}
