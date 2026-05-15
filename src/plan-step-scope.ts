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

function norm(s: string): string {
  return s.toLowerCase();
}

function isMoveOnlyStep(instruction: string): boolean {
  const s = norm(instruction);
  const move = /移动|开到|前往|行驶|导航|移到|go_to/.test(s);
  const other = /拾|捡|pick|放|drop|拍|识别|检测/.test(s);
  return move && !other;
}

function isPickOnlyStep(instruction: string): boolean {
  const s = norm(instruction);
  return /拾|捡|pick|grab|拿起/.test(s) && !/放|drop|拍|识别/.test(s);
}

function isDropOnlyStep(instruction: string): boolean {
  const s = norm(instruction);
  return (/放|drop|放置|卸下/.test(s) || /放到|放在/.test(s)) && !/拾|pick|拍|识别/.test(s);
}

function isCaptureStep(instruction: string): boolean {
  const s = norm(instruction);
  return /拍|识别|检测|detect|vision|坐标/.test(s);
}

/** 当前规划步尚未轮到，却调用了明显属于后续阶段的工具 */
export function toolAheadOfPlanStep(currentInstruction: string, toolName: string): boolean {
  if (isMoveOnlyStep(currentInstruction)) {
    return ["pick_up", "drop", "take_photo", "detect_objects"].includes(toolName);
  }
  if (isPickOnlyStep(currentInstruction)) {
    return ["drop", "take_photo", "detect_objects", "go_to"].includes(toolName);
  }
  if (isDropOnlyStep(currentInstruction)) {
    return ["pick_up", "take_photo", "detect_objects", "go_to"].includes(toolName);
  }
  if (isCaptureStep(currentInstruction)) {
    return ["go_to", "pick_up", "drop"].includes(toolName);
  }
  return false;
}

/** 无 tool_calls 的回复是否在宣布做下一步 */
export function assistantTextAheadOfPlanStep(
  currentInstruction: string,
  nextInstruction: string | undefined,
  text: string
): boolean {
  const t = norm(text);
  if (!t || !nextInstruction) return false;
  const next = norm(nextInstruction);

  if (isMoveOnlyStep(currentInstruction)) {
    if (/拾|捡|pick|grab|拿起/.test(next) && /拾|捡|pick|grab|拿起|现在拾|开始拾/.test(t)) return true;
    if (/放|drop/.test(next) && /放|drop|桌上/.test(t)) return true;
    if (/拍|识别/.test(next) && /拍|识别|detect/.test(t)) return true;
  }
  if (isPickOnlyStep(currentInstruction)) {
    if (/放|drop|放到|桌上/.test(next) && /放|drop|桌上|现在放/.test(t)) return true;
  }
  return false;
}
