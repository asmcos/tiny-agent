import { AppConfig } from "./types";

interface ContextEntry {
  role: "user" | "assistant" | "tool" | "summary";
  content: string;
}

export class ContextManager {
  private readonly history: ContextEntry[] = [];

  constructor(private readonly cfg: AppConfig) {}

  add(role: ContextEntry["role"], content: string): void {
    this.history.push({ role, content });
    this.trimIfNeeded();
  }

  compactView(): string {
    return this.history.map((h) => `[${h.role}] ${h.content}`).join("\n");
  }

  private trimIfNeeded(): void {
    const max = this.cfg.limits.maxHistoryItems;
    if (this.history.length <= max) {
      return;
    }

    const overflow = this.history.splice(0, this.history.length - max + 1);
    const merged = overflow.map((x) => `${x.role}:${x.content}`).join(" | ");
    const summary = merged.slice(0, this.cfg.limits.summaryCharLimit);
    this.history.unshift({ role: "summary", content: `Older context: ${summary}...` });
  }
}
