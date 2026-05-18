import fs from "node:fs";
import path from "node:path";
import { renderMarkdownToHtml } from "./log-markdown";
import type { TokenUsageSummary, TraceStep, TraceStepType } from "./trace";

const STEP_LABEL: Record<TraceStepType, string> = {
  plan: "规划",
  execute: "执行",
  model_turn: "模型轮次",
  tool: "工具"
};

const STEP_CLASS: Record<TraceStepType, string> = {
  plan: "badge-plan",
  execute: "badge-execute",
  model_turn: "badge-model",
  tool: "badge-tool"
};

export type ModelIoEntry = { ts: string; stage: string; data: unknown };

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtInt(n: number): string {
  return Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "0";
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function readNdjson(filePath: string): unknown[] {
  const raw = fs.readFileSync(filePath, "utf8").trim();
  if (!raw) return [];
  return raw.split("\n").map((line) => JSON.parse(line) as unknown);
}

export function jsonPathToHtmlPath(jsonPath: string): string {
  if (/\.model-io\.json$/i.test(jsonPath)) {
    return jsonPath.replace(/\.model-io\.json$/i, ".model-io.html");
  }
  return jsonPath.replace(/\.json$/i, ".html");
}

const SPLIT_IO_CSS = `
    .wrap.wide { max-width: min(96vw, 1600px); }
    .io-pair {
      display: grid;
      grid-template-columns: 1fr 1fr;
      min-height: 120px;
    }
    @media (max-width: 960px) {
      .io-pair { grid-template-columns: 1fr; }
    }
    .io-col { min-width: 0; display: flex; flex-direction: column; border-right: 1px solid var(--border); }
    .io-col:last-child { border-right: none; }
    .io-col-title {
      padding: 0.5rem 1rem;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--muted);
      background: var(--surface2);
      border-bottom: 1px solid var(--border);
    }
    .io-col.req .io-col-title { color: var(--accent); }
    .io-col.res .io-col-title { color: var(--execute); }
    .io-scroll { flex: 1; overflow: auto; max-height: 72vh; padding: 0.75rem 1rem; }
    .split-row {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0;
      border-top: 1px solid var(--border);
    }
    @media (max-width: 960px) {
      .split-row { grid-template-columns: 1fr; }
    }
    .split-cell { min-width: 0; border-right: 1px solid var(--border); padding: 0; }
    .split-cell:last-child { border-right: none; }
    .split-label {
      font-size: 0.72rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--muted);
      padding: 0.45rem 1rem;
      background: var(--bg);
      border-bottom: 1px solid var(--border);
    }
    .msg {
      margin-bottom: 1rem;
      padding-bottom: 1rem;
      border-bottom: 1px dashed var(--border);
    }
    .msg:last-child { border-bottom: none; margin-bottom: 0; padding-bottom: 0; }
    .msg-role {
      display: inline-block;
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--accent);
      margin-bottom: 0.5rem;
    }
    .field-block { margin-bottom: 0.75rem; }
    .field-block:last-child { margin-bottom: 0; }
    .field-label {
      font-size: 0.68rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      margin-bottom: 0.35rem;
    }
    .field-block.reasoning .field-label { color: var(--model); }
    .field-block.content .field-label { color: var(--accent); }
    .field-block.reasoning {
      border-left: 3px solid var(--model);
      padding-left: 0.75rem;
      background: color-mix(in srgb, var(--model) 6%, transparent);
      border-radius: 0 6px 6px 0;
    }
    .md-prose { font-size: 0.88rem; line-height: 1.55; word-break: break-word; }
    .md-prose p { margin: 0 0 0.65rem; }
    .md-prose p:last-child { margin-bottom: 0; }
    .md-prose h1, .md-prose h2, .md-prose h3 { margin: 0.75rem 0 0.4rem; font-size: 1rem; }
    .md-prose h1 { font-size: 1.1rem; }
    .md-prose ul, .md-prose ol { margin: 0 0 0.65rem; padding-left: 1.25rem; }
    .md-prose code {
      font-family: ui-monospace, Consolas, monospace;
      font-size: 0.82em;
      background: var(--bg);
      padding: 0.1em 0.35em;
      border-radius: 4px;
    }
    .md-prose pre.md-code {
      margin: 0.5rem 0;
      padding: 0.65rem 0.75rem;
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      overflow: auto;
      max-height: 320px;
    }
    .md-prose pre.md-code code { background: none; padding: 0; }
    .md-empty { color: var(--muted); font-style: italic; }
    .meta-line { font-size: 0.8rem; color: var(--muted); margin-bottom: 0.75rem; }
`;

type PageOpts = { subtitle?: string; wide?: boolean };

function pageShell(title: string, body: string, opts?: PageOpts): string {
  const subtitle = opts?.subtitle;
  const wide = opts?.wide ?? false;
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root {
      --bg: #0f1419;
      --surface: #1a2332;
      --surface2: #243044;
      --border: #2d3a4f;
      --text: #e6edf3;
      --muted: #8b9cb3;
      --accent: #58a6ff;
      --plan: #a371f7;
      --execute: #3fb950;
      --model: #d29922;
      --tool: #f778ba;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    .wrap { max-width: 1100px; margin: 0 auto; padding: 1.5rem 1.25rem 3rem; }
    ${SPLIT_IO_CSS}
    header { margin-bottom: 1.5rem; }
    h1 { font-size: 1.35rem; font-weight: 600; margin: 0 0 0.35rem; }
    .sub { color: var(--muted); font-size: 0.9rem; }
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 0.75rem;
      margin-bottom: 1.5rem;
    }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 0.75rem 1rem;
    }
    .card .label { font-size: 0.75rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; }
    .card .value { font-size: 1.25rem; font-weight: 600; margin-top: 0.2rem; }
    .timeline { display: flex; flex-direction: column; gap: 1rem; }
    .step {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 10px;
      overflow: hidden;
    }
    .step-head {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.5rem 0.75rem;
      padding: 0.65rem 1rem;
      background: var(--surface2);
      border-bottom: 1px solid var(--border);
    }
    .idx { color: var(--muted); font-size: 0.85rem; min-width: 2rem; }
    .badge {
      font-size: 0.72rem;
      font-weight: 600;
      padding: 0.15rem 0.5rem;
      border-radius: 999px;
      text-transform: uppercase;
      letter-spacing: 0.03em;
    }
    .badge-plan { background: color-mix(in srgb, var(--plan) 25%, transparent); color: var(--plan); }
    .badge-execute { background: color-mix(in srgb, var(--execute) 25%, transparent); color: var(--execute); }
    .badge-model { background: color-mix(in srgb, var(--model) 25%, transparent); color: var(--model); }
    .badge-tool { background: color-mix(in srgb, var(--tool) 25%, transparent); color: var(--tool); }
    .badge-req { background: color-mix(in srgb, var(--accent) 22%, transparent); color: var(--accent); }
    .badge-res { background: color-mix(in srgb, var(--execute) 22%, transparent); color: var(--execute); }
    .meta-tags { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-left: auto; }
    .tag {
      font-size: 0.75rem;
      color: var(--muted);
      background: var(--bg);
      border: 1px solid var(--border);
      padding: 0.1rem 0.45rem;
      border-radius: 4px;
    }
    .step-body { padding: 0.5rem 0; }
    details { border-top: 1px solid var(--border); }
    details:first-of-type { border-top: none; }
    summary {
      cursor: pointer;
      padding: 0.55rem 1rem;
      font-size: 0.85rem;
      font-weight: 500;
      color: var(--muted);
      user-select: none;
    }
    summary:hover { color: var(--text); }
    pre {
      margin: 0;
      padding: 0.75rem 1rem 1rem;
      font-family: ui-monospace, "Cascadia Code", "SF Mono", Consolas, monospace;
      font-size: 0.8rem;
      line-height: 1.45;
      white-space: pre-wrap;
      word-break: break-word;
      background: var(--bg);
      border-top: 1px solid var(--border);
      max-height: 480px;
      overflow: auto;
    }
    .empty { color: var(--muted); padding: 2rem; text-align: center; }
    footer { margin-top: 2rem; font-size: 0.8rem; color: var(--muted); }
  </style>
</head>
<body>
  <div class="wrap${wide ? " wide" : ""}">
    <header>
      <h1>${escapeHtml(title)}</h1>
      ${subtitle ? `<p class="sub">${escapeHtml(subtitle)}</p>` : ""}
    </header>
    ${body}
    <footer>tiny-agent · generated ${escapeHtml(new Date().toISOString())}</footer>
  </div>
</body>
</html>`;
}

function usageCards(summary: TokenUsageSummary): string {
  if (!summary.total_tokens && !summary.prompt_tokens) {
    return "";
  }
  const cards: Array<[string, string]> = [
    ["输入 tokens", fmtInt(summary.prompt_tokens)],
    ["输出 tokens", fmtInt(summary.completion_tokens)],
    ["合计", fmtInt(summary.total_tokens)]
  ];
  if (summary.cached_prompt_tokens > 0) {
    cards.push(["提示缓存", fmtInt(summary.cached_prompt_tokens)]);
  }
  if (summary.reasoning_tokens > 0) {
    cards.push(["补全推理", fmtInt(summary.reasoning_tokens)]);
  }
  const html = cards
    .map(
      ([label, value]) =>
        `<div class="card"><div class="label">${escapeHtml(label)}</div><div class="value">${escapeHtml(value)}</div></div>`
    )
    .join("");
  return `<section class="cards">${html}</section>`;
}

function metaTags(meta?: Record<string, unknown>): string {
  if (!meta) return "";
  const skip = new Set([
    "prompt_tokens",
    "completion_tokens",
    "total_tokens",
    "cached_prompt_tokens",
    "billed_prompt_tokens_est",
    "reasoning_tokens"
  ]);
  const tags: string[] = [];
  for (const [k, v] of Object.entries(meta)) {
    if (skip.has(k) || v == null || v === "") continue;
    tags.push(`<span class="tag">${escapeHtml(k)}: ${escapeHtml(String(v))}</span>`);
  }
  return tags.length ? `<div class="meta-tags">${tags.join("")}</div>` : "";
}

function usageLine(meta?: Record<string, unknown>): string | null {
  const p = Number(meta?.prompt_tokens ?? 0);
  const c = Number(meta?.completion_tokens ?? 0);
  const t = Number(meta?.total_tokens ?? 0);
  if (!(p || c || t)) return null;
  return `tokens 输入 ${fmtInt(p)} · 输出 ${fmtInt(c)} · 合计 ${fmtInt(t)}`;
}

export function renderTraceHtml(
  steps: TraceStep[],
  usage: TokenUsageSummary,
  opts?: { sourceFile?: string; runId?: string }
): string {
  const subtitle = [opts?.runId ? `run ${opts.runId}` : null, opts?.sourceFile ? path.basename(opts.sourceFile) : null]
    .filter(Boolean)
    .join(" · ");

  if (steps.length === 0) {
    return pageShell("Trace 报告", `<p class="empty">无步骤记录</p>`, { subtitle: subtitle || undefined, wide: true });
  }

  const timeline = steps
    .map((step, i) => {
      const type = step.type as TraceStepType;
      const label = STEP_LABEL[type] ?? step.type;
      const usageTag = usageLine(step.meta);
      const head =
        `<article class="step">` +
        `<div class="step-head">` +
        `<span class="idx">#${i + 1}</span>` +
        `<span class="badge ${STEP_CLASS[type] ?? "badge-model"}">${escapeHtml(label)}</span>` +
        (step.model ? `<span class="tag">${escapeHtml(step.model)}</span>` : "") +
        (usageTag ? `<span class="tag">${escapeHtml(usageTag)}</span>` : "") +
        metaTags(step.meta) +
        `</div>`;

      const body =
        `<div class="step-body split-row">` +
        `<div class="split-cell">` +
        `<div class="split-label">输入 · prompt</div>` +
        `<div class="io-scroll"><div class="md-prose">${renderMarkdownToHtml(step.prompt)}</div></div>` +
        `</div>` +
        `<div class="split-cell">` +
        `<div class="split-label">输出 · output</div>` +
        `<div class="io-scroll"><div class="md-prose">${renderMarkdownToHtml(step.output)}</div></div>` +
        `</div>` +
        `</div>` +
        (step.meta && Object.keys(step.meta).length > 0 ?
          `<details><summary>meta (JSON)</summary><pre>${escapeHtml(prettyJson(step.meta))}</pre></details>`
        : "");

      return head + body + `</article>`;
    })
    .join("");

  const body = usageCards(usage) + `<section class="timeline">${timeline}</section>`;
  return pageShell("Trace 报告", body, { subtitle: subtitle || undefined, wide: true });
}


type IoPairBlock =
  | { kind: "pair"; base: string; req: ModelIoEntry; res: ModelIoEntry }
  | { kind: "single"; entry: ModelIoEntry };

function pairModelIoEntries(entries: ModelIoEntry[]): IoPairBlock[] {
  const blocks: IoPairBlock[] = [];
  let i = 0;
  while (i < entries.length) {
    const cur = entries[i]!;
    if (cur.stage.endsWith("_req")) {
      const base = cur.stage.slice(0, -4);
      const next = entries[i + 1];
      if (next?.stage === `${base}_res`) {
        blocks.push({ kind: "pair", base, req: cur, res: next });
        i += 2;
        continue;
      }
    }
    blocks.push({ kind: "single", entry: cur });
    i += 1;
  }
  return blocks;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function fieldBlock(label: string, text: string, kind: "content" | "reasoning" | "plain"): string {
  const cls = kind === "plain" ? "field-block" : `field-block ${kind}`;
  const body =
    kind === "plain" ?
      `<pre>${escapeHtml(text)}</pre>`
    : `<div class="md-prose">${renderMarkdownToHtml(text)}</div>`;
  return `<div class="${cls}"><div class="field-label">${escapeHtml(label)}</div>${body}</div>`;
}

function renderToolCalls(toolCalls: unknown): string {
  if (!toolCalls) return "";
  return (
    `<details class="field-block">` +
    `<summary class="field-label" style="cursor:pointer">tool_calls</summary>` +
    `<pre>${escapeHtml(prettyJson(toolCalls))}</pre></details>`
  );
}

function renderChatMessage(msg: Record<string, unknown>): string {
  const role = String(msg.role ?? "unknown");
  const parts: string[] = [`<article class="msg"><div class="msg-role">${escapeHtml(role)}</div>`];

  const reasoning = msg.reasoning_content;
  if (reasoning != null && String(reasoning).trim()) {
    parts.push(fieldBlock("reasoning_content", String(reasoning), "reasoning"));
  }

  const content = msg.content;
  if (content != null && String(content).trim()) {
    parts.push(fieldBlock("content", String(content), "content"));
  } else if (content === null && !reasoning) {
    parts.push(`<p class="md-empty">（content 为空）</p>`);
  }

  if (msg.tool_calls) {
    parts.push(renderToolCalls(msg.tool_calls));
  }

  const toolCallId = msg.tool_call_id;
  if (toolCallId) {
    parts.push(`<p class="meta-line">tool_call_id: ${escapeHtml(String(toolCallId))}</p>`);
  }

  parts.push("</article>");
  return parts.join("");
}

function renderRequestColumn(data: unknown): string {
  const rec = asRecord(data);
  if (!rec) {
    return `<pre>${escapeHtml(prettyJson(data))}</pre>`;
  }

  const parts: string[] = [];
  const meta: string[] = [];
  if (rec.model) meta.push(`model: ${rec.model}`);
  if (rec.temperature != null) meta.push(`temperature: ${rec.temperature}`);
  if (rec.max_tokens != null) meta.push(`max_tokens: ${rec.max_tokens}`);
  if (meta.length) {
    parts.push(`<p class="meta-line">${escapeHtml(meta.join(" · "))}</p>`);
  }

  const messages = rec.messages;
  if (Array.isArray(messages) && messages.length > 0) {
    for (const m of messages) {
      const msg = asRecord(m);
      if (msg) parts.push(renderChatMessage(msg));
    }
  } else {
    parts.push(`<pre>${escapeHtml(prettyJson(data))}</pre>`);
  }

  if (rec.tools && Array.isArray(rec.tools) && rec.tools.length > 0) {
    parts.push(
      `<details class="field-block"><summary class="field-label" style="cursor:pointer">tools (${rec.tools.length})</summary>` +
        `<pre>${escapeHtml(prettyJson(rec.tools))}</pre></details>`
    );
  }

  return parts.join("");
}

function renderResponseColumn(data: unknown): string {
  const rec = asRecord(data);
  if (!rec) {
    return `<pre>${escapeHtml(prettyJson(data))}</pre>`;
  }

  const parts: string[] = [];
  const usage = asRecord(rec.usage);
  if (usage) {
    const u: string[] = [];
    if (usage.prompt_tokens != null) u.push(`prompt: ${usage.prompt_tokens}`);
    if (usage.completion_tokens != null) u.push(`completion: ${usage.completion_tokens}`);
    if (usage.total_tokens != null) u.push(`total: ${usage.total_tokens}`);
    if (u.length) parts.push(`<p class="meta-line">usage · ${escapeHtml(u.join(" · "))}</p>`);
  }
  if (rec.model) {
    parts.push(`<p class="meta-line">model · ${escapeHtml(String(rec.model))}</p>`);
  }

  const choices = rec.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    for (let ci = 0; ci < choices.length; ci++) {
      const choice = asRecord(choices[ci]);
      const message = choice ? asRecord(choice.message) : null;
      if (!message) continue;
      if (choices.length > 1) {
        parts.push(`<p class="meta-line">choice[${ci}]</p>`);
      }
      parts.push(renderChatMessage(message));
    }
    return parts.join("");
  }

  const message = asRecord(rec.message);
  if (message) {
    parts.push(renderChatMessage(message));
    return parts.join("");
  }

  parts.push(`<pre>${escapeHtml(prettyJson(data))}</pre>`);
  return parts.join("");
}

function renderIoPairBlock(block: IoPairBlock, index: number): string {
  if (block.kind === "single") {
    const e = block.entry;
    return (
      `<article class="step">` +
      `<div class="step-head">` +
      `<span class="idx">#${index + 1}</span>` +
      `<span class="badge badge-model">事件</span>` +
      `<span class="tag">${escapeHtml(e.stage)}</span>` +
      `<span class="tag">${escapeHtml(e.ts)}</span>` +
      `</div>` +
      `<div class="io-scroll" style="max-height:60vh">` +
      `<pre>${escapeHtml(prettyJson(e.data))}</pre>` +
      `</div></article>`
    );
  }

  return (
    `<article class="step">` +
    `<div class="step-head">` +
    `<span class="idx">#${index + 1}</span>` +
    `<span class="tag">${escapeHtml(block.base)}</span>` +
    `<span class="tag">${escapeHtml(block.req.ts)}</span>` +
    `</div>` +
    `<div class="io-pair">` +
    `<div class="io-col req">` +
    `<div class="io-col-title">请求 · Request</div>` +
    `<div class="io-scroll">${renderRequestColumn(block.req.data)}</div>` +
    `</div>` +
    `<div class="io-col res">` +
    `<div class="io-col-title">响应 · Response</div>` +
    `<div class="io-scroll">${renderResponseColumn(block.res.data)}</div>` +
    `</div>` +
    `</div></article>`
  );
}

export function renderModelIoHtml(entries: ModelIoEntry[], opts?: { sourceFile?: string }): string {
  const subtitle = opts?.sourceFile ? path.basename(opts.sourceFile) : undefined;

  if (entries.length === 0) {
    return pageShell("Model I/O 报告", `<p class="empty">无请求记录</p>`, { subtitle, wide: true });
  }

  const blocks = pairModelIoEntries(entries);
  const timeline = blocks.map((b, i) => renderIoPairBlock(b, i)).join("");

  return pageShell("Model I/O 报告", `<section class="timeline">${timeline}</section>`, {
    subtitle,
    wide: true
  });
}

export function writeHtmlFile(htmlPath: string, html: string): string {
  fs.mkdirSync(path.dirname(htmlPath), { recursive: true });
  fs.writeFileSync(htmlPath, html, "utf8");
  return htmlPath;
}

export function writeTraceHtmlFromSteps(
  steps: TraceStep[],
  usage: TokenUsageSummary,
  jsonPath: string,
  runId?: string
): string {
  const htmlPath = jsonPathToHtmlPath(jsonPath);
  const html = renderTraceHtml(steps, usage, { sourceFile: jsonPath, runId });
  return writeHtmlFile(htmlPath, html);
}

export function convertTraceJsonFile(jsonPath: string): string {
  const abs = path.resolve(jsonPath);
  const rows = readNdjson(abs) as TraceStep[];
  const usage = summarizeUsageFromSteps(rows);
  const runId = path.basename(abs, ".json");
  return writeTraceHtmlFromSteps(rows, usage, abs, runId);
}

export function convertModelIoJsonFile(jsonPath: string): string {
  const abs = path.resolve(jsonPath);
  const rows = readNdjson(abs) as ModelIoEntry[];
  const htmlPath = jsonPathToHtmlPath(abs);
  const html = renderModelIoHtml(rows, { sourceFile: abs });
  return writeHtmlFile(htmlPath, html);
}

/** 将指定路径的 trace / model-io JSON 转为 HTML */
export function convertLogJsonFiles(paths: string[]): string[] {
  const out: string[] = [];
  for (const p of paths) {
    const abs = path.resolve(p);
    if (!fs.existsSync(abs)) continue;
    if (/\.model-io\.json$/i.test(abs)) {
      out.push(convertModelIoJsonFile(abs));
    } else if (/\.json$/i.test(abs)) {
      out.push(convertTraceJsonFile(abs));
    }
  }
  return out;
}

function summarizeUsageFromSteps(steps: TraceStep[]): TokenUsageSummary {
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

  for (const step of steps) {
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

    const bucket = step.type;
    if (!byType[bucket]) byType[bucket] = emptyBucket();
    const b = byType[bucket]!;
    b.prompt_tokens += p;
    b.completion_tokens += c;
    b.total_tokens += t;
    b.cached_prompt_tokens += cached;
    b.billed_prompt_tokens_est += billed;
    b.reasoning_tokens += reasoning;
  }

  return { ...total, by_type: byType };
}
