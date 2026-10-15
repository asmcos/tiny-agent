import { AppError } from "../../shared/errors";
import type { ModelGateway, ModelMessage, ModelToolDefinition } from "../../models/contracts";

export const ROUTE_TARGETS = ["code", "desktop", "system", "word", "ppt", "robot"] as const;

export type RouteTarget = (typeof ROUTE_TARGETS)[number];

export type RouteTurn = {
  utterance: string;
  target: RouteTarget;
  task: string;
};

export type RouteDecision = {
  target: RouteTarget;
  task: string;
};

const TARGET_LIST = ROUTE_TARGETS.join("、");

const ROUTE_TOOL: ModelToolDefinition = {
  name: "route.assign",
  description: "把当前这句话分配给一个模块，并带上要交给该模块的任务原文。",
  inputSchema: {
    type: "object",
    properties: {
      target: { type: "string", enum: [...ROUTE_TARGETS] },
      task: { type: "string", description: "交给该模块的任务，保留用户原意" }
    },
    required: ["target", "task"]
  }
};

const SYSTEM =
  "你是顶层路由器。根据当前这句话和之前各轮已经分配的模块，调用 route.assign。" +
  "code：写程序、改文件、跑测试、查代码。" +
  "desktop：截屏、鼠标、键盘、窗口。" +
  "system：看磁盘、网络、日志、系统信息、修电脑。" +
  "word：写或改 Word 文档。" +
  "ppt：写或改演示文稿。" +
  "robot：小车的移动、拿取、放置、转向、停止、传感器。" +
  "短句如「继续」「停」「再来一次」沿用上一轮模块，除非用户明确换了事情。" +
  `target 只能是 ${TARGET_LIST}。不要直接回答用户。`;

export async function routeTask(input: {
  utterance: string;
  history?: RouteTurn[];
  gateway: ModelGateway;
  model: string;
  signal?: AbortSignal;
}): Promise<RouteDecision> {
  const messages: ModelMessage[] = [
    { role: "system", content: SYSTEM },
    ...historyMessages(input.history ?? []),
    { role: "user", content: input.utterance }
  ];
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await input.gateway.generate({
      model: input.model,
      messages,
      tools: [ROUTE_TOOL],
      signal: input.signal
    });
    const call = response.message.toolCalls?.find((item) => item.name === "route.assign");
    if (!call) {
      messages.push(response.message);
      messages.push({
        role: "user",
        content: `必须调用 route.assign，target 只能是 ${TARGET_LIST}。`
      });
      continue;
    }
    return parseAssign(call.argumentsJson, input.utterance);
  }
  throw new AppError("INVALID_MODEL_RESPONSE", "路由器没有调用 route.assign");
}

export function historyMessages(history: RouteTurn[]): ModelMessage[] {
  const recent = history.slice(-12);
  const messages: ModelMessage[] = [];
  for (const turn of recent) {
    messages.push({ role: "user", content: turn.utterance });
    messages.push({
      role: "assistant",
      content: "",
      toolCalls: [
        {
          id: `route-${messages.length}`,
          name: "route.assign",
          argumentsJson: JSON.stringify({ target: turn.target, task: turn.task })
        }
      ]
    });
    messages.push({
      role: "tool",
      toolCallId: `route-${messages.length - 1}`,
      name: "route.assign",
      content: `已分配给 ${turn.target}`
    });
  }
  return messages;
}

function parseAssign(argumentsJson: string, utterance: string): RouteDecision {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argumentsJson || "{}");
  } catch {
    throw new AppError("INVALID_MODEL_RESPONSE", "route.assign 参数不是 JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new AppError("INVALID_MODEL_RESPONSE", "route.assign 参数必须是对象");
  }
  const target = (parsed as { target?: unknown }).target;
  if (!isRouteTarget(target)) {
    throw new AppError("INVALID_MODEL_RESPONSE", `route.assign 的 target 只能是 ${TARGET_LIST}`);
  }
  const task = (parsed as { task?: unknown }).task;
  const text = typeof task === "string" && task.trim() ? task.trim() : utterance;
  return { target, task: text };
}

function isRouteTarget(value: unknown): value is RouteTarget {
  return typeof value === "string" && (ROUTE_TARGETS as readonly string[]).includes(value);
}
