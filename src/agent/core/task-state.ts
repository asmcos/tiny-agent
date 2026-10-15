import { AppError } from "../../shared/errors";
import type { TaskStatus } from "../../shared/events";

const EDGES: Record<TaskStatus, readonly TaskStatus[]> = {
  queued: ["planning", "cancelled"],
  planning: ["running", "failed", "cancelled"],
  running: [
    "waiting_approval",
    "paused",
    "needs_input",
    "cancelling",
    "succeeded",
    "failed"
  ],
  waiting_approval: ["running", "cancelled", "failed"],
  paused: ["running", "cancelled"],
  cancelling: ["cancelled", "failed"],
  needs_input: ["running", "cancelled"],
  succeeded: [],
  failed: [],
  cancelled: []
};

export function assertTransition(from: TaskStatus, to: TaskStatus): void {
  if (!EDGES[from].includes(to)) {
    throw new AppError("INTERNAL_ERROR", `非法任务状态迁移：${from} → ${to}`);
  }
}

export function isTerminal(status: TaskStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}
