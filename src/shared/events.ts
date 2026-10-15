export type TaskStatus =
  | "queued"
  | "planning"
  | "running"
  | "waiting_approval"
  | "paused"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "needs_input";

export type AgentEvent =
  | { type: "task.status_changed"; taskId: string; status: TaskStatus; createdAt: string }
  | { type: "assistant.delta"; taskId: string; text: string; createdAt: string }
  | { type: "tool.proposed"; taskId: string; toolCallId: string; toolName: string; createdAt: string }
  | { type: "tool.approval_required"; taskId: string; toolCallId: string; reason: string; createdAt: string }
  | { type: "tool.started"; taskId: string; toolCallId: string; createdAt: string }
  | { type: "tool.finished"; taskId: string; toolCallId: string; status: string; createdAt: string }
  | { type: "task.finished"; taskId: string; status: TaskStatus; createdAt: string };
