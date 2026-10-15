import { AppError } from "../../shared/errors";

export type StopLimits = {
  maxIterations: number;
  maxToolCalls: number;
  maxConsecutiveFailures: number;
  maxTaskDurationMs: number;
};

export type StopSnapshot = {
  iterations: number;
  toolCalls: number;
  consecutiveFailures: number;
  startedAtMs: number;
  lastFailureSignature?: string;
  repeatedFailureStreak: number;
};

export function checkStop(limits: StopLimits, snap: StopSnapshot, now = Date.now()): AppError | null {
  if (snap.iterations >= limits.maxIterations) {
    return new AppError("TASK_LIMIT_REACHED", `已达到最大模型轮数 ${limits.maxIterations}`);
  }
  if (snap.toolCalls >= limits.maxToolCalls) {
    return new AppError("TASK_LIMIT_REACHED", `已达到最大工具调用次数 ${limits.maxToolCalls}`);
  }
  if (snap.consecutiveFailures >= limits.maxConsecutiveFailures) {
    return new AppError("TASK_LIMIT_REACHED", `连续失败已达 ${limits.maxConsecutiveFailures} 次`);
  }
  if (snap.repeatedFailureStreak >= limits.maxConsecutiveFailures) {
    return new AppError("TASK_LIMIT_REACHED", "相同工具、参数和错误重复出现，已停止");
  }
  if (now - snap.startedAtMs >= limits.maxTaskDurationMs) {
    return new AppError("TASK_LIMIT_REACHED", "已达到单任务时间上限");
  }
  return null;
}
