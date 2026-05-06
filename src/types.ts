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
  };
  prompts?: {
    planner?: string;
    executor?: string;
  };
}

/** 规划阶段解析后的一步：机器可读标签 + 给人/执行模型看的说明 */
export interface ParsedPlanStep {
  /** 原始规划行（含编号与标签） */
  rawLine: string;
  /** 如 CAPTURE / VISION；缺失表示旧式自由文本，执行时退回启发式选工具 */
  planTag: string | null;
  /** 去掉 `N. [TAG]` 前缀后的说明句 */
  instruction: string;
}

export interface PlanResult {
  goal: string;
  selectedSkills: string[];
  selectedTools: string[];
  steps: string[];
}

export interface ToolCall {
  name: string;
  params: Record<string, unknown>;
}

export interface ExecuteResult {
  message: string;
  toolCalls: ToolCall[];
  done: boolean;
}
