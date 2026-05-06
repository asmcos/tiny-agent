import * as fs from "fs";
import * as path from "path";
import { TinyAgent } from "../src/agent";

async function smokeTest() {
  console.log("--- SMOKE TEST START ---");

  const skillsDir = path.join(process.cwd(), "toolkits", "cars", "skills");
  if (!fs.existsSync(skillsDir)) {
    console.error("FAIL: expected skills dir", skillsDir);
    process.exit(1);
  }

  const agent = new TinyAgent();
  const task = "Use the hello tool to greet 'World'";
  
  console.log(`Task: ${task}`);
  try {
    const result = await agent.run(task);
    console.log("\nResult:");
    console.log(result);
    console.log("\n--- SMOKE TEST PASSED ---");
  } catch (err) {
    console.error("\n--- SMOKE TEST FAILED ---");
    console.error(err);
    process.exit(1);
  }
}

smokeTest();
