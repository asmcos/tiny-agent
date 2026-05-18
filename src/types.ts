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
    /** 为 true 时规划器首轮输出 Facts survey + Plan（默认 false，省 token） */
    structuredPlanning?: boolean;
    /** 规划步模式：每步独立短上下文、工具成功后即结束本步（默认 true） */
    compactPlanExecution?: boolean;
    /** 每个规划步内最多 LLM 轮数（默认 3） */
    maxRoundsPerPlanStep?: number;
    /** 跳过最终总结 LLM 调用（compact 时默认 true） */
    skipFinalSummary?: boolean;
  };
  prompts?: {
    planner?: string;
    executor?: string;
  };
}
