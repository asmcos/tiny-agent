import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runAgent } from "./agent/core/agent-runner";
import { createRouteSession, dispatchUtterance } from "./agent/routing/dispatch";
import { limitsFromConfig, loadConfig, type AppConfig } from "./config";
import { createId } from "./shared/ids";
import { OpenAICompatibleGateway } from "./models/openai-adapter";
import { registerBuiltinTools } from "./tools/builtin/register";
import { ToolRegistry } from "./tools/registry";
import type { AgentEvent } from "./shared/events";
import type { PermissionMode } from "./tools/contracts";

function selectProvider(config: AppConfig): {
  model: string;
  apiKey: string;
  baseURL: string;
  temperature?: number;
  maxTokens?: number;
  headers?: Record<string, string>;
} {
  if (config.activeProvider === "ollama") {
    return {
      model: config.providers.ollama.model,
      apiKey: "ollama",
      baseURL: config.providers.ollama.baseUrl ?? "http://127.0.0.1:11434/v1",
      temperature: config.providers.ollama.temperature,
      maxTokens: config.providers.ollama.maxTokens
    };
  }
  if (config.activeProvider === "opencode") {
    const provider = config.providers.opencode;
    if (!provider?.apiKey) throw new Error("未配置 providers.opencode.apiKey");
    return {
      model: provider.model,
      apiKey: provider.apiKey,
      baseURL: provider.baseUrl ?? "https://opencode.ai/zen/go/v1",
      temperature: provider.temperature,
      maxTokens: provider.maxTokens,
      headers: { "x-opencode-session": createId() }
    };
  }
  return {
    model: config.providers.deepseek.model,
    apiKey: config.providers.deepseek.apiKey ?? "",
    baseURL: config.providers.deepseek.baseUrl ?? "https://api.deepseek.com/v1",
    temperature: config.providers.deepseek.temperature,
    maxTokens: config.providers.deepseek.maxTokens
  };
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function flags(name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < process.argv.length; i++) {
    if (process.argv[i] === name && process.argv[i + 1]) values.push(process.argv[i + 1]!);
  }
  return values;
}

async function main(): Promise<void> {
  const workspace = arg("--workspace");
  const words = process.argv.slice(2).filter((part, index, all) => {
    if (part.startsWith("--")) return false;
    const prev = all[index - 1];
    return prev !== "--workspace" && prev !== "--mode" && prev !== "--config" && prev !== "--allow-command";
  });
  if (!workspace) {
    console.error(
      "用法:\n" +
        "  交互: tsx src/cli.ts --workspace <目录> [--mode read_only|workspace_edit|controlled_auto]\n" +
        "  单次: tsx src/cli.ts --workspace <目录> \"任务\""
    );
    process.exit(2);
  }
  const config = loadConfig(arg("--config"));
  const mode = (arg("--mode") as PermissionMode | undefined) ?? config.permissions.mode;
  const selected = selectProvider(config);
  const gateway = new OpenAICompatibleGateway({
    apiKey: selected.apiKey,
    baseURL: selected.baseURL,
    defaultModel: selected.model,
    temperature: selected.temperature,
    maxOutputTokens: selected.maxTokens,
    headers: selected.headers
  });
  const model = selected.model;
  const registry = new ToolRegistry();
  registerBuiltinTools(registry, config.terminal.defaultTimeoutSeconds * 1000, {
    currentModel: model,
    listModels: () => gateway.listModels()
  });

  const rl = readline.createInterface({ input, output });
  const shared = {
    workspaceRoot: workspace,
    mode,
    allowCommands: [...config.permissions.allowCommands, ...flags("--allow-command")],
    gateway,
    registry,
    model,
    limits: limitsFromConfig(config),
    maxContextMessages: config.agent.maxContextMessages,
    approver: async (request: { toolName: string; argumentsJson: string }) => {
      const answer = (await rl.question(`批准执行 ${request.toolName} ${request.argumentsJson} ? [y/N] `)).trim();
      return answer === "y" || answer === "Y";
    },
    onEvent: (event: AgentEvent) => {
      if (event.type === "tool.proposed") console.error(`\n[工具] ${event.toolName}`);
      if (event.type === "tool.finished") console.error(`[结果] ${event.status}`);
    }
  };

  const session = createRouteSession();
  const dispatch = (utterance: string) =>
    dispatchUtterance({
      utterance,
      session,
      gateway,
      model,
      runCode: async (task, prior) => {
        const result = await runAgent({ ...shared, task, prior });
        return { report: result.report, transcript: result.transcript, ok: result.status === "succeeded" };
      }
    });

  if (words.length === 0) {
    console.log(`工作区 ${workspace}`);
    console.log(`模式 ${mode} · 模型 ${model}`);
    console.log("直接输入任务。每句会按对话路由到编程、电脑控制、系统维修、Word、PPT 或小车。/exit 退出。\n");
    while (true) {
      const line = (await rl.question("> ")).trim();
      if (!line) continue;
      if (line === "/exit" || line === "/quit") break;
      const result = await dispatch(line);
      console.error(`[路由] ${result.target}`);
      console.log(`\n${result.report || "(模型没有返回正文)"}\n`);
    }
    rl.close();
    return;
  }

  const result = await dispatch(words.join(" "));
  console.error(`[路由] ${result.target}`);
  rl.close();
  console.log(result.report);
  if (!result.ok) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
