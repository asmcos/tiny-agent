import type { ToolRegistry } from "../registry";
import {
  fileDiffTool,
  fileEditTool,
  fileReadTool,
  fileSearchTool,
  fileWriteTool,
  workspaceListTool
} from "./files";
import { agentStatusTool } from "./agent-status";
import { modelsListTool, type ModelInfo } from "./models";
import { gitDiffTool, gitStatusTool, processListTool, terminalRunTool, testRunTool } from "./process-tools";

export function registerBuiltinTools(
  registry: ToolRegistry,
  terminalTimeoutMs: number,
  models?: { currentModel: string; listModels: () => Promise<ModelInfo[]> }
): void {
  const tools = [
    workspaceListTool(),
    fileReadTool(),
    fileSearchTool(),
    fileWriteTool(),
    fileEditTool(),
    fileDiffTool(),
    terminalRunTool(terminalTimeoutMs),
    processListTool(),
    testRunTool(terminalTimeoutMs),
    gitStatusTool(),
    gitDiffTool(),
    agentStatusTool()
  ];
  if (models) tools.push(modelsListTool(models));
  for (const tool of tools) registry.register(tool);
}
