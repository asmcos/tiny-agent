import chalk from "chalk";
import type { TraceStep, TokenUsageSummary, TraceStepType } from "./trace";

/** Terminal layout style (smolagents-inspired: panels + section rules). */
export type UiFormat = "panels" | "compact";

const ACCENT: Record<"cyan" | "magenta" | "green" | "yellow" | "blue" | "gray", (s: string) => string> = {
  cyan: (s) => chalk.cyan(s),
  magenta: (s) => chalk.magenta(s),
  green: (s) => chalk.green(s),
  yellow: (s) => chalk.yellow(s),
  blue: (s) => chalk.blue(s),
  gray: (s) => chalk.gray(s)
};

function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}

/** Terminal display width (CJK / fullwidth ≈ 2 cols). ANSI stripped for measurement. */
export function displayWidth(s: string): number {
  let w = 0;
  const v = stripAnsi(s);
  for (const ch of v) {
    const cp = ch.codePointAt(0)!;
    w += codePointWidth(cp);
  }
  return w;
}

function codePointWidth(cp: number): number {
  if (cp === 0) return 0;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2329 && cp <= 0x232a) ||
    (cp >= 0x2e80 && cp <= 0x3247) ||
    (cp >= 0x3250 && cp <= 0x4dbf) ||
    (cp >= 0x4e00 && cp <= 0xa4c6) ||
    (cp >= 0xa960 && cp <= 0xa97c) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x2fffd) ||
    (cp >= 0x30000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  if (cp === 0xfe0f || (cp >= 0x300 && cp <= 0x36f)) return 0;
  return 1;
}

/** Append spaces so visible width is at least `target` (ANSI in `s` preserved). */
function padEndVisual(s: string, target: number): string {
  const w = displayWidth(s);
  if (w >= target) return s;
  return s + " ".repeat(target - w);
}

function sliceByDisplayWidth(s: string, maxW: number): [string, string] {
  let acc = "";
  let w = 0;
  let i = 0;
  const v = s;
  while (i < v.length) {
    const cp = v.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const cw = codePointWidth(cp);
    if (w + cw > maxW) break;
    acc += ch;
    w += cw;
    i += cp >= 0x10000 ? 2 : 1;
  }
  return [acc, v.slice(i)];
}

function wrapLinesByDisplayWidth(text: string, maxDisplayW: number): string[] {
  const out: string[] = [];
  for (const para of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!para) {
      out.push(" ");
      continue;
    }
    let rest = para;
    while (rest.length > 0) {
      if (displayWidth(rest) <= maxDisplayW) {
        out.push(rest);
        break;
      }
      let low = 1;
      let high = rest.length;
      let best = 1;
      while (low <= high) {
        const mid = (low + high) >> 1;
        const slice = rest.slice(0, mid);
        if (displayWidth(slice) <= maxDisplayW) {
          best = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }
      let cut = best;
      const space = rest.lastIndexOf(" ", cut);
      if (space > cut >> 1) cut = space;
      const piece = rest.slice(0, cut).trimEnd();
      out.push(piece.length > 0 ? piece : rest.slice(0, cut));
      rest = rest.slice(cut).trimStart();
    }
  }
  return out.length ? out : [" "];
}

/** Horizontal rule with centered title (display-width aware). */
export function printRule(title: string, accent: keyof typeof ACCENT = "yellow"): void {
  const cols = Math.max(40, process.stdout?.columns ?? 80);
  const raw = title.trim();
  const tw = displayWidth(raw);
  const inner = tw + 2;
  const dash = Math.max(2, Math.floor((cols - inner) / 2));
  const left = "━".repeat(dash);
  const right = "━".repeat(Math.max(2, cols - dash - inner));
  console.log(ACCENT[accent](left) + " " + chalk.bold.white(raw) + " " + ACCENT[accent](right));
}

function borderColor(variant: keyof typeof ACCENT): (s: string) => string {
  return ACCENT[variant];
}

/**
 * Box: top/bottom same width; inner rows `│ ` + content + ` │` with CJK-safe padding.
 */
export function printPanel(opts: {
  title: string;
  subtitle?: string;
  body: string;
  variant?: keyof typeof ACCENT;
}): void {
  const variant = opts.variant ?? "cyan";
  const b = borderColor(variant);
  const term = Math.max(40, process.stdout?.columns ?? 80);
  const maxInner = Math.max(24, Math.min(96, term - 4));

  const headline = opts.subtitle
    ? `${chalk.bold(opts.title)} ${chalk.dim("· " + opts.subtitle)}`
    : chalk.bold(opts.title);

  const bodyLines = wrapLinesByDisplayWidth(opts.body.replace(/\r\n/g, "\n"), maxInner);
  const hw = displayWidth(headline);
  const bw = bodyLines.reduce((m, l) => Math.max(m, displayWidth(l)), 0);
  const inner = Math.min(maxInner, Math.max(8, hw, bw));

  const titleRow = padEndVisual(headline, inner);
  const paddedBody = bodyLines.map((l) => padEndVisual(l, inner));

  const dashCount = inner + 2;
  console.log(`${b("╭")}${b("─").repeat(dashCount)}${b("╮")}`);
  console.log(`${b("│")} ${titleRow} ${b("│")}`);
  for (const row of paddedBody) {
    console.log(`${b("│")} ${row} ${b("│")}`);
  }
  console.log(`${b("╰")}${b("─").repeat(dashCount)}${b("╯")}`);
}

const traceAccent: Record<TraceStep["type"], keyof typeof ACCENT> = {
  plan: "magenta",
  execute: "blue",
  model_turn: "cyan",
  tool: "green"
};

/** OpenAI usage fields stored in trace `meta` (used by `formatUsageLine` / `metaWithoutOpenAiUsageKeys`). */
const OPENAI_USAGE_META_KEYS = new Set([
  "prompt_tokens",
  "completion_tokens",
  "total_tokens",
  "cached_prompt_tokens",
  "billed_prompt_tokens_est",
  "reasoning_tokens"
]);

export function metaWithoutOpenAiUsageKeys(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (!OPENAI_USAGE_META_KEYS.has(k)) out[k] = v;
  }
  return out;
}

function num(x: unknown): number {
  return Number(x ?? 0);
}

function fmtInt(x: number): string {
  return x.toLocaleString();
}

/**
 * 单行展示本调用的 Token 用量（中文标签；数值与接口 `usage` 一致）。
 */
export function formatUsageLine(meta?: Record<string, unknown>): string | null {
  if (!meta) return null;
  const input = num(meta.prompt_tokens);
  const output = num(meta.completion_tokens);
  const totalRaw = num(meta.total_tokens);
  const total = totalRaw > 0 ? totalRaw : input + output;
  const cached = num(meta.cached_prompt_tokens);
  const billed = num(meta.billed_prompt_tokens_est);
  const reasoning = num(meta.reasoning_tokens);
  if (!(input || output || total || cached || billed || reasoning)) return null;

  const parts: string[] = [
    `输入：${fmtInt(input)}`,
    `输出：${fmtInt(output)}`,
    `合计：${fmtInt(total)}`
  ];
  if (cached > 0) parts.push(`提示缓存：${fmtInt(cached)}`);
  if (billed > 0 && (cached > 0 || billed !== input)) parts.push(`计费输入约：${fmtInt(billed)}`);
  if (reasoning > 0) parts.push(`补全推理：${fmtInt(reasoning)}`);
  return parts.join(" · ");
}

const TRACE_STEP_ZH: Record<TraceStepType, string> = {
  plan: "规划",
  execute: "执行",
  model_turn: "模型轮次",
  tool: "工具"
};

/** 文末汇总块（全中文标签）。 */
export function formatRunTokenUsagePlaintext(summary: TokenUsageSummary): string {
  const lines: string[] = [
    "说明：以下为接口返回的 Token 计数（按模型计费维度，不是字符串字符数）。",
    `输入：${fmtInt(summary.prompt_tokens)} · 输出：${fmtInt(summary.completion_tokens)} · 合计：${fmtInt(summary.total_tokens)}`
  ];
  const detail: string[] = [];
  if (summary.cached_prompt_tokens > 0) detail.push(`提示缓存：${fmtInt(summary.cached_prompt_tokens)}`);
  if (summary.billed_prompt_tokens_est > 0) detail.push(`计费输入约：${fmtInt(summary.billed_prompt_tokens_est)}`);
  if (summary.reasoning_tokens > 0) detail.push(`补全推理：${fmtInt(summary.reasoning_tokens)}`);
  if (detail.length) lines.push(detail.join(" · "));

  for (const [k, v] of Object.entries(summary.by_type)) {
    if (!v) continue;
    const zh = TRACE_STEP_ZH[k as TraceStepType] ?? k;
    const row = [
      `输入：${fmtInt(v.prompt_tokens)}`,
      `输出：${fmtInt(v.completion_tokens)}`,
      `合计：${fmtInt(v.total_tokens)}`
    ];
    let tail = "";
    if (v.cached_prompt_tokens > 0 || v.reasoning_tokens > 0) {
      tail = ` · 提示缓存：${fmtInt(v.cached_prompt_tokens)} · 补全推理：${fmtInt(v.reasoning_tokens)}`;
    }
    lines.push(`【${zh}】${row.join(" · ")}${tail}`);
  }
  return lines.join("\n");
}

/** 与 logStep 横幅一致：Step 7 / 8 */
function agentLoopStepPart(meta?: Record<string, unknown>): string | null {
  if (meta && typeof meta.step === "number" && typeof meta.step_total === "number") {
    return `Step ${meta.step} / ${meta.step_total}`;
  }
  return null;
}

function tracePanelLabels(step: TraceStep): { title: string; subtitle?: string; bodyPrefix: string } {
  const meta = step.meta;
  const loopPart = agentLoopStepPart(meta);
  const stepPart =
    meta && typeof meta.execute_step === "number" && typeof meta.execute_step_total === "number"
      ? `第 ${meta.execute_step}/${meta.execute_step_total} 步`
      : null;
  const roundPart =
    meta && typeof meta.round === "number" ? `第 ${meta.round} 轮 LLM` : null;
  const subParts = [loopPart, stepPart, roundPart].filter(Boolean);

  if (step.type === "plan") {
    const isReplan = step.meta?.mid_run_replan === true;
    const replanAt =
      typeof step.meta?.replan_at_execute_step === "number"
        ? ` · 执行第 ${step.meta.replan_at_execute_step} 步前更新`
        : "";
    return {
      title: isReplan ? "规划 · 更新" : "规划",
      subtitle: isReplan ? `中途 replan${replanAt}` : "首轮拆解",
      bodyPrefix: isReplan
        ? "_说明_\n本段为执行中途根据轨迹更新的剩余计划。\n\n"
        : "_说明_\n本段为首轮规划输出。\n\n"
    };
  }
  if (step.type === "model_turn") {
    return {
      title: "执行 · LLM",
      subtitle: subParts.length ? subParts.join(" · ") : undefined,
      bodyPrefix: ""
    };
  }
  if (step.type === "tool") {
    const name = step.prompt.match(/^([a-z_]+)\(/i)?.[1] ?? "tool";
    return {
      title: "工具",
      subtitle: name,
      bodyPrefix: ""
    };
  }
  if (step.type === "execute") {
    if (step.prompt === "final summary" || step.meta?.phase === "final_summary") {
      return {
        title: "总结",
        subtitle: "全任务收尾（无工具）",
        bodyPrefix: ""
      };
    }
    return {
      title: "执行 · 本步收尾",
      subtitle: subParts.length ? subParts.join(" · ") : undefined,
      bodyPrefix: ""
    };
  }
  return { title: String(step.type), subtitle: undefined, bodyPrefix: "" };
}

export function printTraceStep(_index: number, step: TraceStep, format: UiFormat): void {
  const usageLine = formatUsageLine(step.meta);
  const usageBlock = usageLine ? `\n_本调用用量_\n${chalk.dim(usageLine)}` : "";

  if (format === "compact") {
    const labels = tracePanelLabels(step);
    console.log(`\n=== [${labels.title}${labels.subtitle ? ` · ${labels.subtitle}` : ""}] ===`);
    if (step.model) console.log(`model: ${step.model}`);
    if (usageLine) console.log(chalk.dim(usageLine));
    console.log("--- prompt ---");
    console.log(step.prompt);
    console.log("--- output ---");
    console.log(step.output);
    return;
  }

  const labels = tracePanelLabels(step);
  const body = [
    labels.bodyPrefix,
    step.model ? `_model_\n${step.model}` : "",
    usageBlock,
    `_prompt_\n${truncateVisual(step.prompt, 4000)}`,
    `_output_\n${truncateVisual(step.output, 8000)}`
  ]
    .filter(Boolean)
    .join("\n\n");

  printPanel({
    title: labels.title,
    subtitle: labels.subtitle,
    body,
    variant: traceAccent[step.type]
  });
}

function truncateVisual(s: string, maxDisplay: number): string {
  if (displayWidth(s) <= maxDisplay) return s;
  let acc = "";
  let w = 0;
  let i = 0;
  const v = s;
  while (i < v.length && w < maxDisplay) {
    const cp = v.codePointAt(i)!;
    const ch = String.fromCodePoint(cp);
    const cw = codePointWidth(cp);
    if (w + cw > maxDisplay) break;
    acc += ch;
    w += cw;
    i += cp >= 0x10000 ? 2 : 1;
  }
  return acc + chalk.dim("\n… (truncated for terminal)");
}
