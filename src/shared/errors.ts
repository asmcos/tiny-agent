export type AppErrorCode =
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_RATE_LIMITED"
  | "PROVIDER_UNAVAILABLE"
  | "MODEL_NOT_FOUND"
  | "CONTEXT_TOO_LARGE"
  | "INVALID_MODEL_RESPONSE"
  | "TOOL_NOT_FOUND"
  | "TOOL_INPUT_INVALID"
  | "PERMISSION_DENIED"
  | "APPROVAL_REQUIRED"
  | "WORKSPACE_PATH_DENIED"
  | "FILE_CONFLICT"
  | "COMMAND_TIMEOUT"
  | "COMMAND_FAILED"
  | "TASK_CANCELLED"
  | "TASK_LIMIT_REACHED"
  | "PERSISTENCE_FAILED"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly retryable: boolean;
  readonly userAction?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: AppErrorCode,
    message: string,
    options?: { retryable?: boolean; userAction?: string; details?: Record<string, unknown> }
  ) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.retryable = options?.retryable ?? false;
    this.userAction = options?.userAction;
    this.details = options?.details;
  }
}

export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new AppError("INTERNAL_ERROR", message);
}
