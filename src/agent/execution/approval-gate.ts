import type { PermissionMode, ToolRisk } from "../../tools/contracts";
import { toolPermission } from "../../tools/contracts";
import type { ToolDefinition } from "../../tools/contracts";

export type AuthDecision = "allow" | "deny" | "ask";

/** 代码层权限。提示词不能代替这里的判断。 */
export function authorize(input: {
  risk?: ToolRisk;
  tool?: ToolDefinition;
  mode: PermissionMode;
  commandKey?: string;
  allowCommands?: ReadonlySet<string>;
}): AuthDecision {
  const risk = input.tool ? toolPermission(input.tool) : input.risk;
  if (risk === "read_only") return "allow";
  if (input.mode === "read_only") return "deny";
  if (risk === "workspace_write") return "allow";
  if (risk === "process") {
    const key = input.commandKey ?? "";
    if (input.mode === "controlled_auto" && key && input.allowCommands?.has(key)) {
      return "allow";
    }
    return "ask";
  }
  return "deny";
}

export function commandKey(argv: string[]): string {
  return argv.join(" ");
}
