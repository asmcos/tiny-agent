import { AppError } from "../../shared/errors";
import type { ToolDefinition, ToolResult } from "../contracts";

export type ModelInfo = { id: string };

export function modelsListTool(options: {
  currentModel: string;
  listModels: () => Promise<ModelInfo[]>;
}): ToolDefinition {
  return {
    name: "models.list",
    description:
      "列出当前已配置模型供应商上可用的模型 id。用户询问有哪些模型、免费模型或当前模型时必须调用本工具，不要凭记忆编造。",
    risk: "read_only",
    timeoutMs: 20_000,
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute() {
      try {
        const models = await options.listModels();
        const ids = [...new Set(models.map((model) => model.id))].sort();
        const free = ids.filter((id) => /free/i.test(id));
        const lines = [
          `current: ${options.currentModel}`,
          `count: ${ids.length}`,
          free.length ? `free:\n${free.join("\n")}` : "free:\n(列表中没有 id 含 free 的模型)",
          `all:\n${ids.join("\n") || "(空)"}`
        ];
        return { ok: true, output: lines.join("\n") } satisfies ToolResult;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const app = new AppError("PROVIDER_UNAVAILABLE", message, { retryable: true });
        return { ok: false, output: `${app.code}: ${app.message}`, error: app };
      }
    }
  };
}
