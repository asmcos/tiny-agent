/**
 * 将 runs 下的 trace / model-io JSON（NDJSON）转为可浏览的 HTML。
 *
 *   npm run logs:html
 *   npm run logs:html -- runs/1730000000000.json
 *   npm run logs:html -- --all
 */

import fs from "node:fs";
import path from "node:path";
import { convertLogJsonFiles } from "../src/log-html";

function collectPaths(argv: string[]): string[] {
  if (argv.length === 0 || argv.includes("--all")) {
    const runDir = path.resolve(process.cwd(), "runs");
    if (!fs.existsSync(runDir)) {
      console.error(`目录不存在: ${runDir}`);
      process.exit(1);
    }
    return fs
      .readdirSync(runDir)
      .filter((f) => /\.json$/i.test(f))
      .map((f) => path.join(runDir, f))
      .sort();
  }
  return argv.filter((a) => !a.startsWith("-"));
}

function main(): void {
  const paths = collectPaths(process.argv.slice(2));
  if (paths.length === 0) {
    console.error("用法: npm run logs:html [--all | file.json ...]");
    process.exit(1);
  }

  const written = convertLogJsonFiles(paths);
  if (written.length === 0) {
    console.error("未生成任何 HTML（请检查路径是否为 .json / .model-io.json）");
    process.exit(1);
  }

  for (const p of written) {
    console.log(p);
  }
}

main();
