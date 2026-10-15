import fs from "node:fs";
import path from "node:path";
import { AppError } from "../shared/errors";

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", "coverage"]);

export function isIgnoredRelative(rel: string): boolean {
  const parts = rel.split(/[\\/]/).filter(Boolean);
  if (parts.some((part) => SKIP_DIRS.has(part))) return true;
  const base = parts[parts.length - 1] ?? "";
  if (base === ".env" || base.endsWith(".pem") || base.endsWith(".key")) return true;
  return false;
}

/** 把用户路径解析到工作区实路径之内。不存在的新文件则检查其父目录。 */
export function resolveInside(workspaceRoot: string, userPath: string): string {
  const root = fs.realpathSync(path.resolve(workspaceRoot));
  const raw = path.resolve(root, userPath);
  if (isIgnoredRelative(path.relative(root, raw))) {
    throw new AppError("WORKSPACE_PATH_DENIED", `路径被忽略规则拒绝：${userPath}`);
  }

  const target = fs.existsSync(raw) ? fs.realpathSync(raw) : raw;
  const parent = fs.existsSync(raw) ? target : fs.realpathSync(path.dirname(raw));
  const probe = fs.existsSync(raw) ? target : path.join(parent, path.basename(raw));
  const relative = path.relative(root, probe);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new AppError("WORKSPACE_PATH_DENIED", `路径越出工作区：${userPath}`);
  }
  return probe;
}

export function assertInside(workspaceRoot: string, userPath: string): string {
  return resolveInside(workspaceRoot, userPath);
}
