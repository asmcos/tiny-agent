import type { ParsedPlanStep } from "./types";

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
      steps.push({
        rawLine: line,
        planTag: (tagged[2] ?? "").toUpperCase(),
        instruction: (tagged[3] ?? "").trim() || line
      });
      continue;
    }
    const plain = line.match(/^(\d+)\.\s*(.+)$/);
    if (plain) {
      steps.push({
        rawLine: line,
        planTag: null,
        instruction: (plain[2] ?? "").trim()
      });
    }
  }

  return { declaredToolkit, steps };
}

export function legacyStepsFromRaw(raw: string): ParsedPlanStep[] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+\./.test(l))
    .map((line) => ({
      rawLine: line,
      planTag: null,
      instruction: line.replace(/^\d+\.\s*/, "").trim() || line
    }));
}

/** 仅用于 `restrictToolsPerPlanStep`：规划行带 [TAG] 时映射工具；否则返回空（由调用方决定是否限工具）。 */
export function candidateToolsForPlanStep(
  step: ParsedPlanStep,
  tagMap: Record<string, readonly string[]>
): string[] {
  if (!step.planTag) return [];
  const list = tagMap[step.planTag];
  return list?.length ? [...list] : [];
}

export function filterRegisteredTools(names: string[], hasTool: (n: string) => boolean): string[] {
  return names.filter((n) => hasTool(n));
}
