import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { runAgent } from "../agent/core/agent-runner";
import { limitsFromConfig, loadConfig, type AppConfig } from "../config";
import { createId } from "../shared/ids";
import { OpenAICompatibleGateway } from "../models/openai-adapter";
import { registerBuiltinTools } from "../tools/builtin/register";
import { ToolRegistry } from "../tools/registry";
import type { PermissionMode } from "../tools/contracts";
import { UiSession } from "./session";

const WEB_ROOT = path.join(__dirname, "../../web");

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function selectProvider(config: AppConfig) {
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

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(payload);
}

function serveStatic(res: http.ServerResponse, urlPath: string): void {
  const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const file = path.resolve(WEB_ROOT, relative);
  const fromRoot = path.relative(WEB_ROOT, file);
  if (fromRoot.startsWith("..") || path.isAbsolute(fromRoot)) {
    res.writeHead(403);
    res.end();
    return;
  }
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  const type = file.endsWith(".css") ? "text/css" : file.endsWith(".js") ? "text/javascript" : "text/html";
  res.writeHead(200, { "content-type": `${type}; charset=utf-8` });
  fs.createReadStream(file).pipe(res);
}

export function startUiServer(input: {
  workspace: string;
  port: number;
  configPath?: string;
  mode?: PermissionMode;
}): http.Server {
  const config = loadConfig(input.configPath);
  const mode = input.mode ?? config.permissions.mode;
  const selected = selectProvider(config);
  const gateway = new OpenAICompatibleGateway({
    apiKey: selected.apiKey,
    baseURL: selected.baseURL,
    defaultModel: selected.model,
    temperature: selected.temperature,
    maxOutputTokens: selected.maxTokens,
    headers: selected.headers
  });
  const registry = new ToolRegistry();
  registerBuiltinTools(registry, config.terminal.defaultTimeoutSeconds * 1000, {
    currentModel: selected.model,
    listModels: () => gateway.listModels()
  });
  const shared = {
    workspaceRoot: path.resolve(input.workspace),
    mode,
    allowCommands: config.permissions.allowCommands,
    gateway,
    registry,
    model: selected.model,
    limits: limitsFromConfig(config),
    maxContextMessages: config.agent.maxContextMessages
  };
  const ui = new UiSession({
    gateway,
    model: selected.model,
    runCode: async (task, prior, requestApproval, onTool) => {
      let lastTool = "";
      const result = await runAgent({
        ...shared,
        task,
        prior,
        approver: requestApproval,
        onEvent: (event) => {
          if (event.type === "tool.proposed") {
            lastTool = event.toolName;
            onTool(event.toolName, "proposed");
          }
          if (event.type === "tool.finished") onTool(lastTool, event.status);
        }
      });
      return { report: result.report, transcript: result.transcript, ok: result.status === "succeeded" };
    }
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (req.method === "GET" && url.pathname === "/api/meta") {
      sendJson(res, 200, { workspace: shared.workspaceRoot, model: selected.model, mode });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "keep-alive"
      });
      const write = (event: unknown) => res.write(`data: ${JSON.stringify(event)}\n\n`);
      for (const event of ui.events) write(event);
      const unsubscribe = ui.subscribe(write);
      req.on("close", unsubscribe);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/message") {
      const body = JSON.parse((await readBody(req)) || "{}") as { text?: string };
      try {
        ui.submit(String(body.text ?? ""));
        sendJson(res, 202, { accepted: true });
      } catch (error) {
        sendJson(res, 409, { error: error instanceof Error ? error.message : String(error) });
      }
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/approve") {
      const body = JSON.parse((await readBody(req)) || "{}") as { allow?: boolean };
      ui.approve(Boolean(body.allow));
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/reset") {
      ui.reset();
      sendJson(res, 200, { ok: true });
      return;
    }
    if (req.method === "GET") {
      serveStatic(res, url.pathname);
      return;
    }
    sendJson(res, 404, { error: "not found" });
  });
  server.listen(input.port, "127.0.0.1");
  return server;
}

if (require.main === module) {
  const workspace = arg("--workspace") ?? process.cwd();
  const port = Number(arg("--port") ?? 4317);
  startUiServer({ workspace, port, configPath: arg("--config"), mode: arg("--mode") as PermissionMode | undefined });
  console.log(`界面 http://127.0.0.1:${port}`);
  console.log(`工作区 ${path.resolve(workspace)}`);
}
