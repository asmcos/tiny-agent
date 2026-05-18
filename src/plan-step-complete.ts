import type { ParsedPlanStep } from "./types";

/**
 * 判断 compact 模式下本规划步是否已用工具做完。
 * 返回 undefined 表示此策略不表态，由下一策略继续。
 */
export type PlanStepToolCompleteFn = (
  step: ParsedPlanStep,
  calledTools: ReadonlySet<string>
) => boolean | undefined;

/** toolkit / 应用层注入的规划步钩子（核心不硬编码领域） */
export type PlanStepHooks = {
  /** compact 模式下追加到本步 user 的短提示 */
  compactHint?: (step: ParsedPlanStep) => string;
  /** 自定义完成判定；可与 [TAG]+tagToolMap 叠加 */
  isToolComplete?: PlanStepToolCompleteFn;
  /** 某工具执行后追加 user 催促（返回空则不追加） */
  nudgeAfterTool?: (step: ParsedPlanStep, toolName: string, toolOutput: string) => string | null;
  /**
   * 本步 LLM 轮次用尽后的兜底（如自动 drop）。
   * 返回 true 表示已处理，可写入 trace。
   */
  onExhausted?: (
    step: ParsedPlanStep,
    calledTools: ReadonlySet<string>,
    lastToolOutput: string | null,
    invokeTool: (name: string, argsRaw: string) => Promise<string>
  ) => Promise<{ handled: boolean; toolName?: string; toolOutput?: string }>;
};

/**
 * 通用完成判定（按优先级）：
 * 1. 调用方自定义 `custom`
 * 2. 规划行 [TAG] + `tagToolMap`：该 TAG 下列出的工具均已调用
 * 3. 否则不自动判定完成（避免误用领域关键词）
 */
export function isPlanStepToolComplete(
  step: ParsedPlanStep,
  calledTools: ReadonlySet<string>,
  options?: {
    custom?: PlanStepToolCompleteFn;
    tagToolMap?: Record<string, readonly string[]>;
  }
): boolean {
  const custom = options?.custom?.(step, calledTools);
  if (custom === true) return true;
  if (custom === false) return false;

  const tag = step.planTag?.toUpperCase();
  if (tag && options?.tagToolMap?.[tag]?.length) {
    return options.tagToolMap[tag]!.every((name) => calledTools.has(name));
  }

  return false;
}
