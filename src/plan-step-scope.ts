import type { ParsedPlanStep } from "./types";

/** 本步 user 消息：标明范围 + 下一步预览（仅作边界，不规定工具） */
export function buildPlanStepUserContent(
  step: ParsedPlanStep,
  index: number,
  steps: ParsedPlanStep[]
): string {
  const total = steps.length;
  const tagLine = step.planTag ? `\n[PLAN_TAG:${step.planTag}]` : "";
  const next = steps[index + 1];
  const nextPreview = next ? `\n【后续步骤·勿现在执行】第 ${index + 2} 步：${next.instruction}` : "";

  return (
    `【执行 ${index + 1}/${total}】${step.instruction}${tagLine}\n` +
    `【本步范围】只完成：${step.instruction}。不要提前做后续步骤中的动作。\n` +
    `【完成方式】用工具落实本步；本步做完后**最后一轮不要再发起 tool_calls**（可一句确认）。` +
    nextPreview
  );
}

