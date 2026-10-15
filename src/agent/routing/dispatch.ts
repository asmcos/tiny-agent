import type { ModelGateway, ModelMessage } from "../../models/contracts";
import { acceptAssignment } from "../../apps/accept";
import { routeTask, type RouteTarget, type RouteTurn } from "./route-task";

export type RouteSession = {
  history: RouteTurn[];
  codePrior: ModelMessage[];
};

export function createRouteSession(): RouteSession {
  return { history: [], codePrior: [] };
}

export async function dispatchUtterance(input: {
  utterance: string;
  session: RouteSession;
  gateway: ModelGateway;
  model: string;
  signal?: AbortSignal;
  runCode: (
    task: string,
    prior: ModelMessage[]
  ) => Promise<{ report: string; transcript: ModelMessage[]; ok: boolean }>;
  onRouted?: (target: RouteTarget) => void;
}): Promise<{ target: RouteTarget; report: string; ok: boolean }> {
  const decision = await routeTask({
    utterance: input.utterance,
    history: input.session.history,
    gateway: input.gateway,
    model: input.model,
    signal: input.signal
  });
  input.session.history.push({
    utterance: input.utterance,
    target: decision.target,
    task: decision.task
  });
  input.onRouted?.(decision.target);
  if (decision.target === "code") {
    const result = await input.runCode(decision.task, input.session.codePrior);
    input.session.codePrior = result.transcript;
    return { target: decision.target, report: result.report, ok: result.ok };
  }
  return {
    target: decision.target,
    report: acceptAssignment(decision.target, decision.task).report,
    ok: true
  };
}
