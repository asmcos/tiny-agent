/** 轻量 Markdown → 安全 HTML（用于日志页展示 content / reasoning_content） */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/'/g, "&#39;");
}

function inlineMarkdown(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*\n]+)\*/g, "<em>$1</em>");
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, label, href) => {
    const url = String(href).trim();
    if (/^(https?:|mailto:|#)/i.test(url)) {
      return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    }
    return label;
  });
  return s;
}

function flushParagraph(buf: string[], out: string[]): void {
  const joined = buf.join("\n").trim();
  if (joined) {
    out.push(`<p>${inlineMarkdown(joined)}</p>`);
  }
  buf.length = 0;
}

function flushList(
  items: string[],
  out: string[],
  ordered: boolean
): void {
  if (!items.length) return;
  const tag = ordered ? "ol" : "ul";
  out.push(
    `<${tag}>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</${tag}>`
  );
  items.length = 0;
}

/**
 * 将 Markdown 文本转为可嵌入 `.md-prose` 的 HTML（无 script）。
 */
export function renderMarkdownToHtml(source: string): string {
  const text = source.replace(/\r\n/g, "\n");
  if (!text.trim()) {
    return `<p class="md-empty">（空）</p>`;
  }

  const out: string[] = [];
  const paraBuf: string[] = [];
  const ulItems: string[] = [];
  const olItems: string[] = [];
  let inCode = false;
  const codeBuf: string[] = [];

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    if (line.trim().startsWith("```")) {
      if (inCode) {
        const lang = codeBuf[0] ?? "";
        const body = lang ? codeBuf.slice(1) : codeBuf;
        const code = escapeHtml(body.join("\n"));
        out.push(
          `<pre class="md-code"><code${lang ? ` class="lang-${escapeAttr(lang)}"` : ""}>${code}</code></pre>`
        );
        codeBuf.length = 0;
        inCode = false;
      } else {
        flushParagraph(paraBuf, out);
        flushList(ulItems, out, false);
        flushList(olItems, out, true);
        inCode = true;
        codeBuf.push(line.trim().slice(3).trim());
      }
      continue;
    }

    if (inCode) {
      codeBuf.push(line);
      continue;
    }

    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      flushParagraph(paraBuf, out);
      flushList(ulItems, out, false);
      flushList(olItems, out, true);
      const level = h[1]!.length;
      out.push(`<h${level}>${inlineMarkdown(h[2]!)}</h${level}>`);
      continue;
    }

    const ul = line.match(/^[-*+]\s+(.+)$/);
    if (ul) {
      flushParagraph(paraBuf, out);
      flushList(olItems, out, true);
      ulItems.push(ul[1]!);
      continue;
    }

    const ol = line.match(/^\d+\.\s+(.+)$/);
    if (ol) {
      flushParagraph(paraBuf, out);
      flushList(ulItems, out, false);
      olItems.push(ol[1]!);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph(paraBuf, out);
      flushList(ulItems, out, false);
      flushList(olItems, out, true);
      continue;
    }

    flushList(ulItems, out, false);
    flushList(olItems, out, true);
    paraBuf.push(line);
  }

  if (inCode && codeBuf.length) {
    out.push(`<pre class="md-code"><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
  }
  flushParagraph(paraBuf, out);
  flushList(ulItems, out, false);
  flushList(olItems, out, true);

  return out.join("\n") || `<p>${inlineMarkdown(text)}</p>`;
}
