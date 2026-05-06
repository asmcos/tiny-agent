import type { ParsedPlanStep } from "./types";

/** 框架内置：仅通用工具对应的规划标签（不含任何领域 / 小车名） */
export const CORE_PLAN_TAG_TOOL_GROUPS: Record<string, readonly string[]> = {
  READ: ["read_file"],
  WRITE: ["write_file"],
  SHELL: ["bash"],
  SKILL: ["skill_call"],
  ANALYZE: ["read_file", "write_file", "bash", "skill_call"]
};

/** 与各 toolkit 的 plan-tags 模块传入的映射合并（后者可增域标签；同名键由 extra 覆盖） */
export function mergePlanTagToolGroups(
  extra?: Record<string, readonly string[]>
): Record<string, readonly string[]> {
  return { ...CORE_PLAN_TAG_TOOL_GROUPS, ...(extra ?? {}) };
}

/**
 * 解析规划输出：首行可选 toolkit: id；后续为编号 + 方括号 TAG + 说明，或旧式仅编号说明。
 * TAG 原样保留；是否在映射中有定义由调用方 tagMap 决定。
 */
export function parsePlanDocument(raw: string): { declaredToolkit: string | null; steps: ParsedPlanStep[] } {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let declaredToolkit: string | null = null;
  let start = 0;
  if (lines[0]?.match(/^toolkit:\s*\S+/i)) {
    const m = lines[0].match(/^toolkit:\s*(\S+)/i);
    declaredToolkit = m?.[1]?.toLowerCase() ?? null;
    start = 1;
  }

  const steps: ParsedPlanStep[] = [];
  for (const line of lines.slice(start)) {
    const tagged = line.match(/^(\d+)\.\s*\[([A-Z0-9_]+)\]\s*(.*)$/i);
    if (tagged) {
      const tag = (tagged[2] ?? "").toUpperCase();
      const inner = (tagged[3] ?? "").trim();
      steps.push({ rawLine: line, planTag: tag, instruction: inner || line });
      continue;
    }
    const plain = line.match(/^(\d+)\.\s*(.+)$/);
    if (plain) {
      const instruction = (plain[2] ?? "").trim();
      steps.push({ rawLine: line, planTag: null, instruction });
    }
  }

  return { declaredToolkit, steps };
}

/** 当模型未按格式输出时，退回「仅编号」的旧式行 */
export function legacyStepsFromRaw(raw: string): ParsedPlanStep[] {
  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+\./.test(l));
  return lines.map((line) => ({
    rawLine: line,
    planTag: null,
    instruction: line.replace(/^\d+\.\s*/, "").trim() || line
  }));
}

/**
 * 根据合并后的 tag→tools 表与可选启发式，得到本步候选工具名。
 * 未知 TAG 或旧式无标签：先尝试 heuristic，再退回 ANALYZE 对应集合。
 */
export function candidateToolsForPlanStep(
  step: ParsedPlanStep,
  tagMap: Record<string, readonly string[]>,
  heuristic?: (instruction: string) => string[] | undefined
): string[] {
  if (step.planTag) {
    const list = tagMap[step.planTag];
    if (list && list.length > 0) return [...list];
  }
  if (heuristic) {
    const h = heuristic(step.instruction);
    if (h && h.length > 0) return h;
  }
  const fallback = tagMap["ANALYZE"] ?? ["read_file", "write_file", "bash", "skill_call"];
  return [...fallback];
}

export function filterRegisteredTools(names: string[], hasTool: (n: string) => boolean): string[] {
  const core = ["read_file", "write_file", "bash", "skill_call"];
  const hit = names.filter((n) => hasTool(n));
  if (hit.length > 0) return hit;
  return core.filter((n) => hasTool(n));
}
