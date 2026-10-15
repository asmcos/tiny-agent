import { AppError } from "../shared/errors";
import type { ModelGateway, ModelMessage } from "../models/contracts";
import { createRouteSession, dispatchUtterance, type RouteSession } from "../agent/routing/dispatch";
import type { RouteTarget } from "../agent/routing/route-task";

export type UiEvent =
  | { type: "user"; text: string }
  | { type: "route"; target: RouteTarget }
  | { type: "tool"; name: string; phase: string }
  | { type: "approval"; toolName: string; argumentsJson: string; reason: string }
  | { type: "report"; text: string; ok: boolean; target: RouteTarget }
  | { type: "error"; message: string }
  | { type: "reset" };

export type ApprovalRequest = {
  toolName: string;
  argumentsJson: string;
  reason: string;
};

export class UiSession {
  events: UiEvent[] = [];
  busy = false;
  private session: RouteSession = createRouteSession();
  private pending: ((allow: boolean) => void) | null = null;
  private readonly listeners = new Set<(event: UiEvent) => void>();

  constructor(
    private readonly deps: {
      gateway: ModelGateway;
      model: string;
      runCode: (
        task: string,
        prior: ModelMessage[],
        requestApproval: (request: ApprovalRequest) => Promise<boolean>,
        onTool: (name: string, phase: string) => void
      ) => Promise<{ report: string; transcript: ModelMessage[]; ok: boolean }>;
    }
  ) {}

  subscribe(listener: (event: UiEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  submit(text: string): void {
    const utterance = text.trim();
    if (!utterance) return;
    if (this.busy) throw new AppError("TASK_LIMIT_REACHED", "上一句还在处理");
    this.busy = true;
    this.push({ type: "user", text: utterance });
    void this.turn(utterance).finally(() => {
      this.busy = false;
    });
  }

  approve(allow: boolean): void {
    const pending = this.pending;
    this.pending = null;
    pending?.(allow);
  }

  reset(): void {
    this.session = createRouteSession();
    this.approve(false);
    this.events = [];
    this.push({ type: "reset" });
  }

  private async turn(utterance: string): Promise<void> {
    try {
      const result = await dispatchUtterance({
        utterance,
        session: this.session,
        gateway: this.deps.gateway,
        model: this.deps.model,
        runCode: (task, prior) =>
          this.deps.runCode(
            task,
            prior,
            (request) => this.requestApproval(request),
            (name, phase) => this.push({ type: "tool", name, phase })
          ),
        onRouted: (target) => this.push({ type: "route", target })
      });
      this.push({ type: "report", text: result.report, ok: result.ok, target: result.target });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.push({ type: "error", message });
    }
  }

  private requestApproval(request: ApprovalRequest): Promise<boolean> {
    return new Promise((resolve) => {
      this.pending = resolve;
      this.push({ type: "approval", ...request });
    });
  }

  private push(event: UiEvent): void {
    this.events.push(event);
    for (const listener of this.listeners) listener(event);
  }
}
