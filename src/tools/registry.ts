import { AppError } from "../shared/errors";
import type { ToolContext, ToolDefinition, ToolResult } from "./contracts";
import { toolPermission } from "./contracts";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (!tool.name || !tool.inputSchema || tool.inputSchema.type !== "object") {
      throw new AppError("TOOL_INPUT_INVALID", `工具 ${tool.name || "?"} 缺少 object schema`);
    }
    if (this.tools.has(tool.name)) {
      throw new AppError("INTERNAL_ERROR", `工具重名：${tool.name}`);
    }
    this.tools.set(tool.name, { ...tool, permission: toolPermission(tool) });
  }

  unregister(name: string): void {
    this.tools.delete(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  /** 只返回当前权限模式允许直接暴露给模型的工具。进程类工具仍列出，由执行时审批。 */
  listForModel(): ToolDefinition[] {
    return this.list();
  }

  async execute(name: string, input: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      const error = new AppError("TOOL_NOT_FOUND", `未知工具 ${name}`);
      return { ok: false, output: `${error.code}: ${error.message}`, error };
    }
    try {
      validateToolInput(tool.inputSchema, input);
      tool.validate?.(input, context);
    } catch (error) {
      const app = error instanceof AppError ? error : new AppError("TOOL_INPUT_INVALID", String(error));
      return { ok: false, output: `${app.code}: ${app.message}`, error: app };
    }

    const timeout = AbortSignal.timeout(tool.timeoutMs);
    const signal = AbortSignal.any([context.signal, timeout]);
    try {
      return await tool.execute(input, { ...context, signal });
    } catch (error) {
      if (timeout.aborted) {
        const app = new AppError("COMMAND_TIMEOUT", `工具 ${name} 超时`);
        return { ok: false, output: `${app.code}: ${app.message}`, error: app };
      }
      const app = error instanceof AppError ? error : new AppError("INTERNAL_ERROR", String(error));
      return { ok: false, output: `${app.code}: ${app.message}`, error: app };
    }
  }
}

export function validateToolInput(
  schema: Record<string, unknown>,
  input: Record<string, unknown>
): void {
  const required = Array.isArray(schema.required) ? (schema.required as string[]) : [];
  for (const key of required) {
    if (input[key] === undefined || input[key] === null) {
      throw new AppError("TOOL_INPUT_INVALID", `缺少参数 ${key}`);
    }
  }
  const properties = (schema.properties ?? {}) as Record<string, { type?: string }>;
  for (const [key, spec] of Object.entries(properties)) {
    if (input[key] === undefined) continue;
    if (!spec.type) continue;
    if (!typeMatches(spec.type, input[key])) {
      throw new AppError("TOOL_INPUT_INVALID", `参数 ${key} 类型应为 ${spec.type}`);
    }
  }
}

function typeMatches(type: string, value: unknown): boolean {
  if (type === "string") return typeof value === "string";
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number";
  if (type === "boolean") return typeof value === "boolean";
  if (type === "array") return Array.isArray(value);
  if (type === "object") return typeof value === "object" && value !== null && !Array.isArray(value);
  return true;
}
