import { TinyAgent } from "../src/agent";

async function main(): Promise<void> {
  const task =
    process.argv.slice(2).join(" ").trim() ||
    "创建一个 React Button 组件，TypeScript，支持 disabled 和 onClick";

  console.log("=== TinyAgent Example ===");
  console.log("Task:", task);

  const agent = new TinyAgent();
  const result = await agent.run(task);

  console.log("\n=== RESULT ===");
  console.log(result);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
