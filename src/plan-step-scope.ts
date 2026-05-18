import type { ParsedPlanStep } from "./types";

export type PlanStepUserOpts = {
  compact?: boolean;
  /** toolkit 提供的本步短提示（无则不加） */
  stepHint?: string;
};

/** 本步 user 消息：标明范围（compact 模式不要求无 tool_calls 确认轮） */
export function buildPlanStepUserContent(
  step: ParsedPlanStep,
  index: number,
  steps: ParsedPlanStep[],
  opts?: PlanStepUserOpts
): string {
  const total = steps.length;
  const tagLine = step.planTag ? `\n[PLAN_TAG:${step.planTag}]` : "";
  const compact = opts?.compact ?? false;

  const completeLine = compact
    ? "【完成方式】用工具完成本步（感知=拍照+识别；移动=go_to(方位角,距离)；抓取=pick_up；放置=drop）；本步目标达成后自动进入下一步。"
    : "【完成方式】用工具落实本步；本步做完后**最后一轮不要再发起 tool_calls**（可一句确认）。";

  const hintBlock = compact && opts?.stepHint ? `\n${opts.stepHint}` : "";

  const next = steps[index + 1];
  const nextPreview =
    compact || !next ? "" : `\n【后续步骤·勿现在执行】第 ${index + 2} 步：${next.instruction}`;

  return (
    `【执行 ${index + 1}/${total}】${step.instruction}${tagLine}\n` +
    `【本步范围】只完成：${step.instruction}。不要提前做后续步骤中的动作。\n` +
    completeLine +
    hintBlock +
    nextPreview
  );
}

/** compact 模式：跨步只保留一行摘要，不堆叠完整对话 */
export function buildCompactStepUserMessage(
  task: string,
  priorSummaries: readonly string[],
  stepContent: string
): string {
  const prior =
    priorSummaries.length > 0
      ? `\n【已完成】\n${priorSummaries.map((s, i) => `${i + 1}. ${s}`).join("\n")}`
      : "";
  return `【总任务】${task.trim()}${prior}\n\n${stepContent}`;
}

/** 跨步摘要里须完整保留的导航片段（与 compressToolOutputForModel 一致） */
const NAV_HINT_RE =
  /go_to\(bearing_deg=[-\d.]+,\s*distance_m=[\d.]+\)(?:\s+index\d+)?/g;

/**
 * 写入下一步【已完成】摘要：控制总长，但绝不截断 bearing/distance 导航行。
 */
export function briefStepSummary(stepBrief: string, maxLen = 400): string {
  const line = stepBrief.replace(/\s+/g, " ").trim();
  if (line.length <= maxLen) return line;

  const navParts = [...line.matchAll(NAV_HINT_RE)].map((m) => m[0]);
  const uniqueNav = [...new Set(navParts)];
  const navSuffix = uniqueNav.join(" ");
  const navLen = navSuffix ? navSuffix.length + 1 : 0;
  const headMax = maxLen - navLen;

  if (headMax < 48) {
    const title = line.split(/\s+take_photo:/)[0]?.trim() ?? line.slice(0, 48);
    return navSuffix ? `${title} ${navSuffix}`.slice(0, maxLen) : `${line.slice(0, maxLen)}…`;
  }

  let head = line.slice(0, headMax).trim();
  if (!head.endsWith("…")) head = `${head}…`;
  return navSuffix ? `${head} ${navSuffix}` : `${line.slice(0, maxLen)}…`;
}
