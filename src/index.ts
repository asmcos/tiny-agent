import { TinyAgent } from "./agent";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.log("Usage: tiny-agent <task description>");
    process.exit(1);
  }

  const task = args.join(" ");
  const agent = new TinyAgent();

  console.log(`\n🚀 Starting task: ${task}`);
  try {
    const result = await agent.run(task);
    console.log("\n=== FINAL RESULT ===");
    console.log(result);
  } catch (error) {
    console.error("\n❌ Agent failed:");
    console.error(error);
    process.exit(1);
  }
}

main();
