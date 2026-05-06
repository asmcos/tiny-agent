/**
 * 测试：将物体 A 移动到物体 B 旁边 —— 准确性（工具顺序） + token 记录。
 *
 * 离线（默认，零 LLM token）：
 *   npx tsx tests/robot-a-to-b.ts
 *
 * 真实 API（计 token，消耗额度）：
 *   RUN_ROBOT_AB_LIVE=1 npx tsx tests/robot-a-to-b.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { CAR_PLAN_TAG_TOOL_GROUPS, carPlanToolHeuristic } from "../toolkits/cars/plan-tags";
import { buildRobotTools } from "../toolkits/cars/robot-tools";
import { TinyAgent } from "../src/agent";

const TASK =
  "用移动底盘与机械臂：将红色方块移动到绿色柱子旁边并释放。遵守技能 robot-a-to-b 的分阶段感知与工具顺序。";

const EXPECTED_TOOL_CHAIN = [
  "camera_capture",
  "vision_detect",
  "car_control",
  "arm_grasp",
  "camera_capture",
  "vision_detect",
  "car_control",
  "arm_release"
];

function parseTracePath(result: string): string | null {
  const m = result.match(/\(trace:\s*([^)]+)\)/);
  return m?.[1]?.trim() ?? null;
}

function parseTokenBlock(result: string): Record<string, number> {
  const out: Record<string, number> = {};
  const re = /^- (\w+):\s*(\d+)/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(result)) !== null) {
    out[m[1]] = parseInt(m[2], 10);
  }
  return out;
}

/** Trace 文件为逐行 JSON（NDJSON），非单一大 JSON 文档。 */
function toolNamesFromTraceFile(filePath: string): string[] {
  const raw = fs.readFileSync(filePath, "utf8");
  const names: string[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line) as { type?: string; prompt?: string };
    if (row.type !== "tool" || typeof row.prompt !== "string") continue;
    const mm = row.prompt.match(/^([a-z_]+)\(/i);
    if (mm?.[1]) names.push(mm[1]);
  }
  return names;
}

function stripLiveNoise(names: string[]): string[] {
  return names.filter((n) => n !== "skill_call");
}

async function main(): Promise<void> {
  const live = process.env.RUN_ROBOT_AB_LIVE === "1";
  if (!live) {
    process.env.TINY_AGENT_MOCK_LLM = "1";
    process.env.TINY_AGENT_MOCK_LLM_MODULE = "examples/agent-mocks/objectAToBMockFetch.ts";
  } else {
    delete process.env.TINY_AGENT_MOCK_LLM;
    delete process.env.TINY_AGENT_MOCK_LLM_MODULE;
  }

  console.log("=== robot A → beside B ===");
  console.log("mode:", live ? "LIVE (real LLM, costs tokens)" : "MOCK (scripted, LLM tokens=0)");
  console.log("task:", TASK);

  const agent = new TinyAgent({
    extraTools: buildRobotTools(),
    activeToolkit: "cars",
    planTagToolGroups: CAR_PLAN_TAG_TOOL_GROUPS,
    planToolHeuristic: carPlanToolHeuristic
  });
  const result = await agent.run(TASK);

  const tracePath = parseTracePath(result);
  if (!tracePath || !fs.existsSync(tracePath)) {
    console.error("FAIL: trace path missing or not found");
    process.exit(1);
  }

  const rawChain = toolNamesFromTraceFile(tracePath);
  const chain = live ? stripLiveNoise(rawChain) : rawChain;

  const reportDir = path.join(process.cwd(), "runs");
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, "robot-a-to-b-report.json");

  const tokens = parseTokenBlock(result);
  const report = {
    ts: new Date().toISOString(),
    mode: live ? "live" : "mock",
    task: TASK,
    tracePath,
    expected_tool_chain: EXPECTED_TOOL_CHAIN,
    actual_tool_sequence: chain,
    token_usage_parsed: tokens
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2), "utf8");

  let ok = true;
  if (chain.length < EXPECTED_TOOL_CHAIN.length) {
    console.error("FAIL: too few tool steps", chain);
    ok = false;
  } else {
    for (let i = 0; i < EXPECTED_TOOL_CHAIN.length; i++) {
      if (chain[i] !== EXPECTED_TOOL_CHAIN[i]) {
        console.error(`FAIL: step ${i + 1} want ${EXPECTED_TOOL_CHAIN[i]} got ${chain[i]}`);
        ok = false;
        break;
      }
    }
  }

  console.log("\n--- tool chain (first", EXPECTED_TOOL_CHAIN.length, ") ---");
  console.log(chain.slice(0, EXPECTED_TOOL_CHAIN.length).join(" → "));
  console.log("\n--- token_usage (from agent return) ---");
  console.log(JSON.stringify(tokens, null, 2));
  console.log("\nreport written:", reportPath);

  if (!ok) {
    console.error("\nFull tool sequence:", chain.join(" → "));
    process.exit(1);
  }

  console.log("\n--- ROBOT A→B TEST PASSED ---");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
