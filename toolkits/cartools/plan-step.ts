import type { ParsedPlanStep } from "../../src/types";

/** 小车规划步 [TAG] → 本步须调用的工具（与 planner hint 一致） */
export const CAR_PLAN_TAG_TOOLS: Record<string, readonly string[]> = {
  PERCEIVE: ["take_photo", "detect_objects"],
  MOVE: ["go_to"],
  PICKUP: ["pick_up"],
  PLACE: ["drop"]
};

/**
 * 无 [TAG] 时的兜底（兼容旧规划输出）；有 TAG 时返回 undefined 交给 tag 映射。
 */
export function carPlanStepToolComplete(
  step: ParsedPlanStep,
  calledTools: ReadonlySet<string>
): boolean | undefined {
  const tag = step.planTag?.toUpperCase();
  if (tag && tag in CAR_PLAN_TAG_TOOLS) return undefined;

  const has = (name: string) => calledTools.has(name);
  const text = step.instruction.trim();

  if (/放置|放下|放到|搁到/.test(text)) return has("drop");
  if (/抓取|拾取|拿起|取物|捡起/.test(text)) return has("pick_up");
  if (/移动|前往|移到|开到|走到|驶向|导航到|移动至|开至/.test(text)) return has("go_to");
  if (/感知|拍照|定位|观察/.test(text) || /感知.*识别|识别.*目标/.test(text)) {
    return has("take_photo") && has("detect_objects");
  }
  return calledTools.size >= 2 ? true : undefined;
}

export function carCompactStepHint(step: ParsedPlanStep): string {
  const tag = step.planTag?.toUpperCase();
  switch (tag) {
    case "MOVE":
      return "【提示】本步仅移动：用【已完成】里上一步 detect 的 bearing/distance 直接 go_to，勿重新拍照识别。";
    case "PICKUP":
      return "【提示】本步仅抓取：若上一步 go_to 已提示可 pick_up，直接 pick_up。";
    case "PLACE":
      return "【提示】本步须 drop：go_to 返回「可 drop」后立刻 drop，勿再感知/移动。";
    case "PERCEIVE":
      return "【提示】本步：take_photo 后紧接着 detect_objects（可同轮连续 tool_calls）。";
    default:
      break;
  }

  const text = step.instruction.trim();
  if (/移动|前往|移到/.test(text) && !/感知|拍照/.test(text)) {
    return "【提示】移动步：复用【已完成】里 detect 的 bearing/distance，只 go_to。";
  }
  if (/放置|放下|放到/.test(text)) {
    return "【提示】放置步：到位后必须 drop。";
  }
  return "";
}

/** 放置步轮次用尽且已「可 drop」时由 Agent 调用的兜底 */
export function carShouldAutoDrop(
  step: ParsedPlanStep,
  calledTools: ReadonlySet<string>,
  lastToolContent: string
): boolean {
  if (calledTools.has("drop")) return false;
  const tag = step.planTag?.toUpperCase();
  const isPlace =
    tag === "PLACE" || /放置|放下|放到|搁到/.test(step.instruction.trim());
  return isPlace && lastToolContent.includes("可 drop");
}

export function carNudgeAfterTool(
  step: ParsedPlanStep,
  toolName: string,
  toolOutput: string
): string | null {
  if (toolName !== "go_to" || !toolOutput.includes("可 drop")) return null;
  const tag = step.planTag?.toUpperCase();
  const isPlace =
    tag === "PLACE" || /放置|放下|放到|搁到/.test(step.instruction.trim());
  if (!isPlace) return null;
  return "go_to 已到位且提示「可 drop」。请**立即**调用 drop，勿再 take_photo / detect_objects / go_to。";
}

export async function carPlanStepOnExhausted(
  step: ParsedPlanStep,
  calledTools: ReadonlySet<string>,
  lastToolOutput: string | null,
  invokeTool: (name: string, args: string) => Promise<string>
): Promise<{ handled: boolean; toolName?: string; toolOutput?: string }> {
  if (!lastToolOutput || !carShouldAutoDrop(step, calledTools, lastToolOutput)) {
    return { handled: false };
  }
  const output = await invokeTool("drop", "{}");
  return { handled: true, toolName: "drop", toolOutput: output };
}
