export type ProviderName = "ollama" | "deepseek";

export interface BaseProviderConfig {
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface OllamaProviderConfig extends BaseProviderConfig {
  baseUrl?: string;
}

export interface DeepSeekProviderConfig extends BaseProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

export interface ParsedPlanStep {
  rawLine: string;
  planTag: string | null;
  instruction: string;
}

/** Same shape as tiny-agent-origin `config.json`. */
export interface AppConfig {
  activeProvider: ProviderName;
  providers: {
    ollama: OllamaProviderConfig;
    deepseek: DeepSeekProviderConfig;
  };
  limits: {
    maxRounds: number;
    maxHistoryItems: number;
    summaryCharLimit: number;
  };
  skill: {
    rootDir: string;
    summaryHeadLines: number;
  };
  runtime: {
    planOnly: boolean;
    maxStepRounds: number;
    contextWindow: number;
    toolOutputMaxChars: number;
    maxPlanSteps: number;
    planningInterval?: number;
    /** 为 true 时规划器首轮输出 Facts survey + Plan（默认 true） */
    structuredPlanning?: boolean;
  };
  prompts?: {
    planner?: string;
    executor?: string;
  };
}
