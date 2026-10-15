import type { ToolDefinition } from "../contracts";

export function agentStatusTool(): ToolDefinition {
  return {
    name: "agent.status",
    description: "查询当前任务状态、已循环次数和已调用工具次数。",
    permission: "read_only",
    risk: "read_only",
    timeoutMs: 1_000,
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute(_input, ctx) {
      const output = [
        `task=${ctx.taskId}`,
        `status=${ctx.taskStatus ?? "unknown"}`,
        `iteration=${ctx.iteration ?? 0}`,
        `toolCalls=${ctx.toolCallCount ?? 0}`
      ].join("\n");
      return { ok: true, output, data: { taskId: ctx.taskId, status: ctx.taskStatus } };
    }
  };
}
