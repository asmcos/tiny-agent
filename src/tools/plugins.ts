import type { ToolRegistry } from "./registry";
import type { ToolDefinition } from "./contracts";

/**
 * 以后的 desktop、office、system、robot 工具从各自模块调用这里注册。
 * 主循环不需要知道这些模块的内部实现。
 */
export function registerPluginTools(registry: ToolRegistry, tools: ToolDefinition[]): void {
  for (const tool of tools) registry.register(tool);
}
