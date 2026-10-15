import type { ModelMessage } from "../../models/contracts";

export function buildContext(input: {
  system: string;
  task: string;
  prior?: ModelMessage[];
  history: ModelMessage[];
  maxMessages: number;
}): ModelMessage[] {
  const system: ModelMessage = { role: "system", content: input.system };
  const task: ModelMessage = { role: "user", content: input.task };
  const prior = trimHistory(input.prior ?? [], input.maxMessages);
  const history = trimHistory(input.history, input.maxMessages);
  return [system, ...prior, task, ...history];
}

/** 保留最近消息，并保证 tool 结果前面仍有对应的 assistant tool call。 */
function trimHistory(history: ModelMessage[], maxMessages: number): ModelMessage[] {
  if (history.length <= maxMessages) return history;
  const sliced = history.slice(history.length - maxMessages);
  while (sliced[0]?.role === "tool") sliced.shift();
  return sliced;
}
