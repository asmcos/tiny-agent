/**
 * 最小示例：与 tiny-agent-origin 相同形态的 `config.json` 驱动模型。
 *
 *   cp config.example.json config.json   # 填入 apiKey
 *   npm run dev -- "用 multiply 算 17×23"
 *
 * 或指定配置文件：
 *   TINY_AGENT_CONFIG=/path/to/config.json npm run dev
 *
 * 仍可直接传 `OpenAIServerModel`（见 README）。
 */

import { ToolCallingAgent, tool } from "../src";

const calc = tool(
  {
    name: "multiply",
    description: "Multiply two integers.",
    inputs: {
      a: { type: "number", description: "First factor" },
      b: { type: "number", description: "Second factor" }
    },
    outputType: "string"
  },
  async ({ a, b }) => String(Number(a) * Number(b))
);

async function main(): Promise<void> {
  const task = process.argv.slice(2).join(" ").trim() || "用 multiply 算 17×23，然后给出中文结论";

  const agent = new ToolCallingAgent({
    tools: [calc],
    instructions: "Prefer tools over mental math. Reply in Chinese when user writes Chinese."
  });

  const result = await agent.run(task);
  console.log("\n" + result);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
