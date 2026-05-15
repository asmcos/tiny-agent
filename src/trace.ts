import fs from "node:fs";
import path from "node:path";
import { printRule, printTraceStep, type UiFormat } from "./ui";

export type TraceStepType = "plan" | "execute" | "tool" | "model_turn";

export interface TraceStep {
  type: TraceStepType;
  model?: string;
  prompt: string;
  output: string;
  meta?: Record<string, unknown>;
}

export interface TokenUsageSummary {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cached_prompt_tokens: number;
  billed_prompt_tokens_est: number;
  reasoning_tokens: number;
  by_type: Partial<
    Record<
      TraceStepType,
      {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        cached_prompt_tokens: number;
        billed_prompt_tokens_est: number;
        reasoning_tokens: number;
      }
    >
  >;
}

export class TraceStore {
  private readonly steps: TraceStep[] = [];
  private runId = `${Date.now()}`;

  constructor(private readonly uiFormat: UiFormat = "panels") {}

  /** Clear steps and start a new run id (e.g. second `run()` on same agent). */
  reset(): void {
    this.steps.length = 0;
    this.runId = `${Date.now()}`;
  }

  add(step: TraceStep): void {
    this.steps.push(step);
  }

  /** Print one entry by index (for streaming after each `add`). */
  printOne(index: number): void {
    const step = this.steps[index];
    if (!step) return;
    printTraceStep(index, step, this.uiFormat);
  }

  /** Print the most recently pushed step. */
  printLastAdded(): void {
    if (this.steps.length === 0) return;
    this.printOne(this.steps.length - 1);
  }

  print(): void {
    for (let i = 0; i < this.steps.length; i++) {
      this.printOne(i);
    }
    this.printEndMarker();
  }

  printEndMarker(): void {
    if (this.uiFormat === "panels") {
      console.log("");
      printRule("TRACE END", "gray");
    } else {
      console.log("\n=== TRACE END ===");
    }
  }

  summarizeTokenUsage(): TokenUsageSummary {
    const emptyBucket = () => ({
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: 0,
      cached_prompt_tokens: 0,
      billed_prompt_tokens_est: 0,
      reasoning_tokens: 0
    });
    const byType: TokenUsageSummary["by_type"] = {};
    const total = emptyBucket();

    for (const step of this.steps) {
      const p = Number(step.meta?.prompt_tokens ?? 0);
      const c = Number(step.meta?.completion_tokens ?? 0);
      const t = Number(step.meta?.total_tokens ?? 0);
      const cached = Number(step.meta?.cached_prompt_tokens ?? 0);
      const reasoning = Number(step.meta?.reasoning_tokens ?? 0);
      const billed = Math.max(0, p - cached);
      if (!(p || c || t || cached || reasoning)) continue;

      total.prompt_tokens += p;
      total.completion_tokens += c;
      total.total_tokens += t;
      total.cached_prompt_tokens += cached;
      total.billed_prompt_tokens_est += billed;
      total.reasoning_tokens += reasoning;

      const bucket: TraceStepType = step.type;
      if (!byType[bucket]) {
        byType[bucket] = emptyBucket();
      }
      byType[bucket]!.prompt_tokens += p;
      byType[bucket]!.completion_tokens += c;
      byType[bucket]!.total_tokens += t;
      byType[bucket]!.cached_prompt_tokens += cached;
      byType[bucket]!.billed_prompt_tokens_est += billed;
      byType[bucket]!.reasoning_tokens += reasoning;
    }

    return {
      prompt_tokens: total.prompt_tokens,
      completion_tokens: total.completion_tokens,
      total_tokens: total.total_tokens,
      cached_prompt_tokens: total.cached_prompt_tokens,
      billed_prompt_tokens_est: total.billed_prompt_tokens_est,
      reasoning_tokens: total.reasoning_tokens,
      by_type: byType
    };
  }

  summarizeSteps(): Array<{ type: TraceStepType; text: string }> {
    return this.steps.map((s) => ({
      type: s.type,
      text: `${s.prompt}`.replace(/\s+/g, " ").slice(0, 220)
    }));
  }

  getLastToolOutput(toolName: string): string | null {
    for (let i = this.steps.length - 1; i >= 0; i--) {
      const s = this.steps[i];
      if (s.type === "tool" && s.prompt.startsWith(`${toolName}(`)) {
        return s.output;
      }
    }
    return null;
  }

  getToolSequence(): string[] {
    return this.steps
      .filter((s) => s.type === "tool")
      .map((s) => {
        const m = s.prompt.match(/^([a-z_]+)\(/i);
        return m?.[1] ?? "unknown";
      });
  }

  flushToFile(): string {
    const runDir = path.resolve(process.cwd(), "runs");
    fs.mkdirSync(runDir, { recursive: true });
    const filePath = path.join(runDir, `${this.runId}.json`);
    const lines = this.steps.map((s) => JSON.stringify(s)).join("\n");
    fs.writeFileSync(filePath, lines ? `${lines}\n` : "", "utf8");
    return filePath;
  }
}
