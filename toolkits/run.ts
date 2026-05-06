import path from "node:path";
import { TinyAgent } from "../src/agent";
import { CAR_PLAN_TAG_TOOL_GROUPS, carPlanToolHeuristic } from "./cars/plan-tags";
import { buildRobotTools } from "./cars/robot-tools";
import { buildFridgeTools } from "./fridge/fridge-tools";

/**
 * 统一入口：各 toolkit 只有 `skills/` + `*-tools.ts`，不在子目录下放 `main.ts`。
 *
 *   npx tsx toolkits/run.ts cars <任务>
 *   npx tsx toolkits/run.ts fridge <任务>
 */
function parseToolkitAndTask(): { toolkit: string; task: string } {
  const args = process.argv.slice(2);
  let i = 0;
  while (i < args.length && !["cars", "fridge"].includes(args[i]!.toLowerCase())) {
    i++;
  }
  const toolkit = (args[i] ?? "").toLowerCase();
  const task = args.slice(i + 1).join(" ").trim();
  return { toolkit, task };
}

async function run(): Promise<void> {
  const { toolkit, task } = parseToolkitAndTask();

  if (!toolkit || !task) {
    console.log("Usage: npx tsx toolkits/run.ts <cars|fridge> <task description>");
    process.exit(1);
  }

  const repoRoot = path.resolve(__dirname, "..");

  if (toolkit === "cars") {
    const rootConfig = path.join(repoRoot, "config.json");
    const agent = new TinyAgent({
      configPath: rootConfig,
      extraTools: buildRobotTools(),
      activeToolkit: "cars",
      planTagToolGroups: CAR_PLAN_TAG_TOOL_GROUPS,
      planToolHeuristic: carPlanToolHeuristic
    });
    const result = await agent.run(task);
    console.log("\n=== RESULT ===");
    console.log(result);
    return;
  }

  if (toolkit === "fridge") {
    const fridgeDir = path.join(repoRoot, "toolkits", "fridge");
    process.chdir(fridgeDir);
    const agent = new TinyAgent({
      configPath: path.join(fridgeDir, "config.json"),
      extraTools: buildFridgeTools(),
      activeToolkit: "fridge"
    });
    const result = await agent.run(task);
    console.log("\n=== RESULT ===");
    console.log(result);
    return;
  }

  console.error("Unknown toolkit:", toolkit, "(expected cars | fridge)");
  process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
