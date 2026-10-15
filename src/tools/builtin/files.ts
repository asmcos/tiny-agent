import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AppError } from "../../shared/errors";
import { isIgnoredRelative, resolveInside } from "../../workspace/path-policy";
import type { ToolContext, ToolDefinition, ToolResult } from "../contracts";
import { sha256, unifiedDiff } from "./hash";

const MAX_READ_CHARS = 80_000;

function ok(output: string): ToolResult {
  return { ok: true, output };
}

function backupFile(rel: string, before: string): string {
  const dir = path.join(os.tmpdir(), "tiny-agent-backups");
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${Date.now()}-${path.basename(rel)}`);
  fs.writeFileSync(dest, before);
  return dest;
}

function fail(error: AppError): ToolResult {
  return { ok: false, output: `${error.code}: ${error.message}`, error };
}

export function workspaceListTool(): ToolDefinition {
  return {
    name: "workspace.list",
    description: "列出工作区内的文件和目录。",
    risk: "read_only",
    timeoutMs: 10_000,
    inputSchema: {
      type: "object",
      properties: { path: { type: "string", description: "相对工作区的目录，默认 ." } },
      required: []
    },
    async execute(input, ctx) {
      try {
        const rel = typeof input.path === "string" ? input.path : ".";
        const dir = resolveInside(ctx.workspaceRoot, rel);
        const names = fs.readdirSync(dir, { withFileTypes: true });
        const lines = names
          .filter((entry) => !isIgnoredRelative(entry.name))
          .slice(0, 200)
          .map((entry) => `${entry.isDirectory() ? "dir " : "file"} ${entry.name}`);
        return ok(lines.join("\n") || "(空目录)");
      } catch (error) {
        return fail(error instanceof AppError ? error : new AppError("INTERNAL_ERROR", String(error)));
      }
    }
  };
}

export function fileReadTool(): ToolDefinition {
  return {
    name: "file.read",
    description: "按行读取工作区内的文本文件。",
    risk: "read_only",
    timeoutMs: 10_000,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        startLine: { type: "integer" },
        endLine: { type: "integer" }
      },
      required: ["path"]
    },
    async execute(input, ctx) {
      try {
        const file = resolveInside(ctx.workspaceRoot, String(input.path));
        const stat = fs.statSync(file);
        if (!stat.isFile()) return fail(new AppError("TOOL_INPUT_INVALID", "不是文件"));
        if (stat.size > 1_000_000) {
          return fail(new AppError("TOOL_INPUT_INVALID", "文件过大，请指定行范围或改读片段"));
        }
        const text = fs.readFileSync(file, "utf8");
        const lines = text.split("\n");
        const start = Math.max(1, Number(input.startLine ?? 1));
        const end = Math.min(lines.length, Number(input.endLine ?? lines.length));
        const slice = lines.slice(start - 1, end).join("\n").slice(0, MAX_READ_CHARS);
        return ok(`# ${path.relative(ctx.workspaceRoot, file)}:${start}-${end}\n${slice}`);
      } catch (error) {
        return fail(error instanceof AppError ? error : new AppError("INTERNAL_ERROR", String(error)));
      }
    }
  };
}

export function fileSearchTool(): ToolDefinition {
  return {
    name: "file.search",
    description: "在工作区文本文件中搜索关键词。",
    risk: "read_only",
    timeoutMs: 20_000,
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"]
    },
    async execute(input, ctx) {
      try {
        const query = String(input.query ?? "");
        if (!query) return fail(new AppError("TOOL_INPUT_INVALID", "query 为空"));
        const hits: string[] = [];
        walk(ctx.workspaceRoot, ctx.workspaceRoot, query, hits);
        return ok(hits.slice(0, 40).join("\n") || "(无匹配)");
      } catch (error) {
        return fail(error instanceof AppError ? error : new AppError("INTERNAL_ERROR", String(error)));
      }
    }
  };
}

function walk(root: string, dir: string, query: string, hits: string[]): void {
  if (hits.length >= 40) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (isIgnoredRelative(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(root, full, query, hits);
      continue;
    }
    if (!entry.isFile()) continue;
    const stat = fs.statSync(full);
    if (stat.size > 300_000) continue;
    const text = fs.readFileSync(full, "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i]?.includes(query)) continue;
      hits.push(`${path.relative(root, full)}:${i + 1}: ${lines[i]}`);
      if (hits.length >= 40) return;
    }
  }
}

export function fileWriteTool(): ToolDefinition {
  return {
    name: "file.write",
    description: "在工作区新建文本文件。已存在的文件必须用 file.edit。",
    risk: "workspace_write",
    timeoutMs: 10_000,
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"]
    },
    async execute(input, ctx) {
      try {
        return writeNew(ctx, String(input.path), String(input.content ?? ""));
      } catch (error) {
        return fail(error instanceof AppError ? error : new AppError("INTERNAL_ERROR", String(error)));
      }
    }
  };
}

function writeNew(ctx: ToolContext, rel: string, content: string): ToolResult {
  const file = resolveInside(ctx.workspaceRoot, rel);
  if (fs.existsSync(file)) {
    return fail(new AppError("FILE_CONFLICT", "文件已存在，请使用 file.edit"));
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
  const diff = unifiedDiff(rel, "", content);
  ctx.changes.push({ path: rel, beforeHash: sha256(""), afterHash: sha256(content), diff });
  return ok(diff || "(已写入空文件)");
}

export function fileEditTool(): ToolDefinition {
  return {
    name: "file.edit",
    description: "把文件中唯一一段 oldString 替换为 newString，并返回 diff。",
    risk: "workspace_write",
    timeoutMs: 10_000,
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        oldString: { type: "string" },
        newString: { type: "string" },
        expectedHash: { type: "string" }
      },
      required: ["path", "oldString", "newString"]
    },
    async execute(input, ctx) {
      try {
        const rel = String(input.path);
        const file = resolveInside(ctx.workspaceRoot, rel);
        if (!fs.existsSync(file)) return fail(new AppError("TOOL_INPUT_INVALID", "文件不存在"));
        const before = fs.readFileSync(file, "utf8");
        const hash = sha256(before);
        if (typeof input.expectedHash === "string" && input.expectedHash !== hash) {
          return fail(new AppError("FILE_CONFLICT", "文件在读取后已被修改，拒绝覆盖"));
        }
        const oldString = String(input.oldString);
        const count = before.split(oldString).length - 1;
        if (count !== 1) {
          return fail(new AppError("TOOL_INPUT_INVALID", `oldString 需要唯一匹配，实际 ${count} 处`));
        }
        const after = before.replace(oldString, String(input.newString));
        const backupPath = backupFile(rel, before);
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, after);
        fs.renameSync(tmp, file);
        const diff = unifiedDiff(rel, before, after);
        ctx.changes.push({ path: rel, beforeHash: hash, afterHash: sha256(after), diff });
        return ok(`${diff}\nbackup=${backupPath}`);
      } catch (error) {
        return fail(error instanceof AppError ? error : new AppError("INTERNAL_ERROR", String(error)));
      }
    }
  };
}

export function fileDiffTool(): ToolDefinition {
  return {
    name: "file.diff",
    description: "查看本任务已经写入的 diff。",
    risk: "read_only",
    timeoutMs: 5_000,
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute(_input, ctx) {
      if (ctx.changes.length === 0) return ok("(本任务尚无文件改动)");
      return ok(ctx.changes.map((change) => change.diff).join("\n\n"));
    }
  };
}
