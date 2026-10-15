import fs from "node:fs";
import path from "node:path";
import type { PermissionMode } from "./tools/contracts";
import type { StopLimits } from "./agent/core/stop-policy";

export type ProviderName = "ollama" | "deepseek" | "opencode";

export type OpenAIProviderConfig = {
  model: string;
  temperature?: number;
  maxTokens?: number;
  apiKey?: string;
  baseUrl?: string;
};

export type AppConfig = {
  schemaVersion: number;
  activeProvider: ProviderName;
  providers: {
    ollama: OpenAIProviderConfig;
    deepseek: OpenAIProviderConfig;
    opencode?: OpenAIProviderConfig;
  };
  agent: StopLimits & { maxContextMessages: number };
  permissions: { mode: PermissionMode; allowCommands: string[] };
  terminal: { defaultTimeoutSeconds: number; maxOutputCharacters: number };
};

const DEFAULTS = {
  agent: {
    maxIterations: 30,
    maxToolCalls: 60,
    maxConsecutiveFailures: 3,
    maxTaskDurationMs: 1_800_000,
    maxContextMessages: 24
  },
  permissions: { mode: "read_only" as PermissionMode, allowCommands: [] as string[] },
  terminal: { defaultTimeoutSeconds: 120, maxOutputCharacters: 30_000 }
};

export function ensureOpenAIBaseUrl(baseUrl: string): string {
  const cleaned = baseUrl.replace(/\/+$/, "");
  return cleaned.endsWith("/v1") ? cleaned : `${cleaned}/v1`;
}

export function loadConfig(explicitPath?: string): AppConfig {
  const configPath = explicitPath
    ? path.resolve(explicitPath)
    : path.resolve(process.env.TINY_AGENT_CONFIG || "config.json");
  if (!fs.existsSync(configPath)) {
    throw new Error(`Missing config file: ${configPath}`);
  }
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8")) as Partial<AppConfig> & {
    runtime?: { maxTaskDurationSeconds?: number };
  };
  const active = raw.activeProvider ?? "deepseek";
  if (active === "opencode") {
    if (!raw.providers?.opencode?.apiKey || !raw.providers.opencode.model) {
      throw new Error("config.providers.opencode.model 和 apiKey 必填");
    }
  } else if (active === "ollama") {
    if (!raw.providers?.ollama?.model) throw new Error("config.providers.ollama.model 必填");
  } else if (!raw.providers?.deepseek?.apiKey || !raw.providers.deepseek.model) {
    throw new Error("config.providers.deepseek.model 和 apiKey 必填");
  }
  if (!raw.providers?.ollama?.model) {
    throw new Error("config.providers.ollama.model 必填");
  }
  if (!raw.providers.deepseek?.model || !raw.providers.deepseek.apiKey) {
    throw new Error("config.providers.deepseek.model 和 apiKey 必填");
  }
  const durationMs =
    raw.agent?.maxTaskDurationMs ??
    (raw.runtime?.maxTaskDurationSeconds ? raw.runtime.maxTaskDurationSeconds * 1000 : undefined) ??
    DEFAULTS.agent.maxTaskDurationMs;
  return {
    schemaVersion: raw.schemaVersion ?? 1,
    activeProvider: active,
    providers: {
      ollama: raw.providers.ollama,
      deepseek: raw.providers.deepseek,
      ...(raw.providers.opencode ? { opencode: raw.providers.opencode } : {})
    },
    agent: { ...DEFAULTS.agent, ...raw.agent, maxTaskDurationMs: durationMs },
    permissions: { ...DEFAULTS.permissions, ...raw.permissions },
    terminal: { ...DEFAULTS.terminal, ...raw.terminal }
  };
}

export function limitsFromConfig(config: AppConfig): StopLimits {
  return {
    maxIterations: config.agent.maxIterations,
    maxToolCalls: config.agent.maxToolCalls,
    maxConsecutiveFailures: config.agent.maxConsecutiveFailures,
    maxTaskDurationMs: config.agent.maxTaskDurationMs
  };
}

export type { StopLimits };
