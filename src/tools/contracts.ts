import type { AppError } from "../shared/errors";

export type ToolRisk = "read_only" | "workspace_write" | "process";

export type ToolResult = {
  ok: boolean;
  output: string;
  data?: unknown;
  error?: AppError;
};

export type FileChange = {
  path: string;
  beforeHash: string;
  afterHash: string;
  diff: string;
};

export type ToolContext = {
  taskId: string;
  workspaceRoot: string;
  signal: AbortSignal;
  changes: FileChange[];
  taskStatus?: string;
  iteration?: number;
  toolCallCount?: number;
};

export type ToolDefinition = {
  name: string;
  description: string;
  /** JSON Schema object */
  inputSchema: Record<string, unknown>;
  /** 权限等级。未填写时与 risk 相同。 */
  permission?: ToolRisk;
  risk: ToolRisk;
  timeoutMs: number;
  validate?(input: Record<string, unknown>, context: ToolContext): void;
  execute(input: Record<string, unknown>, context: ToolContext): Promise<ToolResult>;
};

export function toolPermission(tool: ToolDefinition): ToolRisk {
  return tool.permission ?? tool.risk;
}

export type PermissionMode = "read_only" | "workspace_edit" | "controlled_auto";
