/**
 * 网格小车 Agent 示例（应用层；仿真与工具在 toolkits/cartools）
 *
 *   cp config.example.json config.json
 *   npx tsx examples/car.ts
 *   npx tsx examples/car.ts "把 index0 的物体搬到 index1"
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { ToolCallingAgent } from "../src";
import { loadConfig, tryLoadConfig } from "../src/config";
import {
  GridCarEnv,
  buildCarDomainInstructionsCompact,
  buildToolkitPlannerHint,
  createCarTools
} from "../toolkits/cartools";

function taskFromArgv(): string | null {
  const words = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  return words.length > 0 ? words.join(" ") : null;
}

async function readInteractiveTask(): Promise<string> {
  const fromArgv = taskFromArgv();
  if (fromArgv) return fromArgv;

  if (!input.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of input) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const t = Buffer.concat(chunks).toString("utf8").trim();
    if (t) return t;
  }

  const rl = readline.createInterface({ input, output });
  try {
    const line = (await rl.question("\n智能小车任务: ")).trim();
    return line || "先拍照了解环境，把 index0 处的物体搬到 index1 处并放下。";
  } finally {
    rl.close();
  }
}

function buildAgent(env: GridCarEnv): ToolCallingAgent {
  const fileConfig = loadConfig();
  const domain = buildCarDomainInstructionsCompact();
  return new ToolCallingAgent({
    config: {
      ...fileConfig,
      runtime: {
        ...fileConfig.runtime,
        compactPlanExecution: fileConfig.runtime?.compactPlanExecution ?? true,
        maxRoundsPerPlanStep: fileConfig.runtime?.maxRoundsPerPlanStep ?? 3,
        skipFinalSummary: fileConfig.runtime?.skipFinalSummary ?? true,
        structuredPlanning: fileConfig.runtime?.structuredPlanning ?? false
      },
      prompts: {
        ...(fileConfig.prompts ?? {}),
        planner: [fileConfig.prompts?.planner, buildToolkitPlannerHint("cars")]
          .filter(Boolean)
          .join("\n\n"),
        executor: [domain, fileConfig.prompts?.executor].filter(Boolean).join("\n\n")
      }
    },
    tools: createCarTools(env),
    activeToolkit: "cars",
    planStepMode: true,
    restrictToolsPerPlanStep: false,
    planningInterval: undefined,
    ui: { format: "panels" }
  });
}

async function main(): Promise<void> {
  console.log("=".repeat(56));
  console.log("  智能小车 · tiny-agent + cartools");
  console.log("=".repeat(56));

  if (!tryLoadConfig()) {
    console.error("缺少 config.json，请: cp config.example.json config.json");
    process.exit(1);
  }

  const task = await readInteractiveTask();
  const env = new GridCarEnv({
    hints: ["index0", "index1"]
  });

  console.log("\n初始:", env.getStatusText());
  console.log("任务:", task, "\n");

  const result = await buildAgent(env).run(task);
  console.log("\n📝", result);

  if (!env.done) {
    console.log("\n当前状态:", env.getStatusText());
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
