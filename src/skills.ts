import fs from "node:fs";
import path from "node:path";
import { AppConfig } from "./types";

export interface SkillSummary {
  name: string;
  description: string;
  keywords: string[];
  summary: string;
  filePath: string;
}

export class SkillRegistry {
  private readonly summaries: SkillSummary[] = [];

  constructor(private readonly cfg: AppConfig) {
    this.loadSkillSummaries();
  }

  listSummaries(): SkillSummary[] {
    return this.summaries;
  }

  pickRelevant(task: string, topK = 3): SkillSummary[] {
    const taskLower = task.toLowerCase();
    const queryTokens = this.toTokens(task);
    const taskBigrams = this.cjkBigrams(task);

    const scored = this.summaries.map((skill) => {
      let score = 0;
      for (const token of queryTokens) {
        if (skill.keywords.includes(token)) {
          score += 2;
        }
        if (skill.description.toLowerCase().includes(token)) {
          score += 1;
        }
        if (skill.name.toLowerCase().includes(token)) {
          score += 3;
        }
      }

      // Keywords may omit short Chinese tokens; substring match helps.
      for (const kw of skill.keywords) {
        const k = kw.toLowerCase();
        if (k.length >= 2 && taskLower.includes(k)) {
          score += 2;
        }
      }

      // Chinese: whole "让小车向前…" often becomes one long token; overlap 2-grams with skill text.
      const skillText = [skill.name, skill.description, skill.summary, skill.keywords.join(" ")].join("\n");
      const skillBigrams = this.cjkBigrams(skillText);
      const skillBiSet = new Set(skillBigrams);
      for (const b of taskBigrams) {
        if (skillBiSet.has(b)) score += 1;
      }

      return { skill, score };
    });

    return scored
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map((x) => x.skill);
  }

  readSkillFull(name: string): string {
    const matched = this.summaries.find((s) => s.name === name);
    if (!matched) {
      return `Skill ${name} not found`;
    }
    return fs.readFileSync(matched.filePath, "utf8");
  }

  private loadSkillSummaries(): void {
    const dir = path.resolve(process.cwd(), this.cfg.skill.rootDir);
    if (!fs.existsSync(dir)) {
      return;
    }

    const files = this.collectSkillFiles(dir);
    for (const filePath of files) {
      const content = fs.readFileSync(filePath, "utf8");
      const lines = content.split("\n").map((l) => l.trim()).filter(Boolean);
      const parsed = this.parseStandardMetadata(content);
      const fallbackName = this.buildFallbackName(filePath, dir);
      const name = parsed.name || fallbackName;
      const description = parsed.description || lines[0] || "No summary";
      const summary = lines.slice(0, 1 + this.cfg.skill.summaryHeadLines).join("\n");
      const keywords = lines
        .slice(1, 1 + this.cfg.skill.summaryHeadLines)
        .join(" ")
        .toLowerCase()
        .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
        .filter((w) => w.length > 2)
        .slice(0, 10);

      this.summaries.push({ name, description, keywords, summary, filePath });
    }
  }

  private collectSkillFiles(rootDir: string): string[] {
    const out: string[] = [];
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isFile() && entry.name.endsWith(".md")) {
        out.push(fullPath);
        continue;
      }
      if (entry.isDirectory()) {
        const skillFile = path.join(fullPath, "SKILL.md");
        if (fs.existsSync(skillFile)) {
          out.push(skillFile);
        }
      }
    }
    return out;
  }

  private buildFallbackName(filePath: string, rootDir: string): string {
    const rel = path.relative(rootDir, filePath).replace(/\\/g, "/");
    if (/\/SKILL\.md$/i.test(rel)) {
      return rel.replace(/\/SKILL\.md$/i, "");
    }
    return rel.replace(/\.md$/i, "");
  }

  private parseStandardMetadata(content: string): { name?: string; description?: string } {
    const out: { name?: string; description?: string } = {};

    // Standard markdown frontmatter support:
    // ---
    // name: xxx
    // description: yyy
    // ---
    const fm = content.match(/^---\n([\s\S]*?)\n---/);
    if (fm?.[1]) {
      for (const rawLine of fm[1].split("\n")) {
        const line = rawLine.trim();
        const nameMatch = line.match(/^name:\s*(.+)$/i);
        if (nameMatch?.[1]) {
          out.name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
        }
        const descMatch = line.match(/^description:\s*(.+)$/i);
        if (descMatch?.[1]) {
          out.description = descMatch[1].trim().replace(/^["']|["']$/g, "");
        }
      }
    }

    // Fallback for inline metadata lines:
    // Name: xxx
    // Description: yyy
    if (!out.name) {
      const m = content.match(/^\s*name:\s*(.+)$/im);
      if (m?.[1]) {
        out.name = m[1].trim();
      }
    }
    if (!out.description) {
      const m = content.match(/^\s*description:\s*(.+)$/im);
      if (m?.[1]) {
        out.description = m[1].trim();
      }
    }

    return out;
  }

  private toTokens(text: string): string[] {
    return text
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
      .filter((w) => w.length > 1);
  }

  /** Adjacent CJK pairs inside each Han run (e.g. 小车 in 让小车向前). */
  private cjkBigrams(text: string): string[] {
    const out: string[] = [];
    const re = /[\u4e00-\u9fa5]{2,}/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const seg = m[0];
      for (let i = 0; i < seg.length - 1; i++) {
        out.push(seg.slice(i, i + 2));
      }
    }
    return out;
  }
}
