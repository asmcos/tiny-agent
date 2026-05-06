import fs from "node:fs";
import path from "node:path";
import { exec } from "node:child_process";
import { promisify } from "node:util";
import { SkillRegistry } from "./skills";

const execAsync = promisify(exec);

export interface Tool {
  name: string;
  description: string;
  jsonSchema: Record<string, unknown>;
  run(params: Record<string, unknown>): Promise<string>;
}

/** 框架内置通用工具；领域工具（如小车）由各 `toolkits/*` 通过 `TinyAgent({ extraTools })` 注入。 */
export function buildTools(skills: SkillRegistry): Tool[] {
  return [
    {
      name: "read_file",
      description: "Read text file from project",
      jsonSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" }
        },
        required: ["path"]
      },
      async run(params) {
        const rel = String(params.path ?? "");
        const full = path.resolve(process.cwd(), rel);
        return fs.readFileSync(full, "utf8");
      }
    },
    {
      name: "write_file",
      description: "Write text file in project",
      jsonSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative file path" },
          content: { type: "string", description: "File content" }
        },
        required: ["path", "content"]
      },
      async run(params) {
        const rel = String(params.path ?? "");
        const content = String(params.content ?? "");
        const full = path.resolve(process.cwd(), rel);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, content, "utf8");
        return `Wrote ${rel}`;
      }
    },
    {
      name: "bash",
      description: "Run safe shell command",
      jsonSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run" }
        },
        required: ["command"]
      },
      async run(params) {
        const command = String(params.command ?? "");
        try {
          const { stdout, stderr } = await execAsync(command, { cwd: process.cwd() });
          return [stdout, stderr].filter(Boolean).join("\n").trim();
        } catch (error) {
          const e = error as { stdout?: string; stderr?: string; message?: string };
          return [e.stdout, e.stderr, e.message].filter(Boolean).join("\n").trim();
        }
      }
    },
    {
      name: "skill_call",
      description: "Load full skill markdown by name",
      jsonSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Skill name without extension" }
        },
        required: ["name"]
      },
      async run(params) {
        const name = String(params.name ?? "");
        return skills.readSkillFull(name);
      }
    }
  ];
}

export function toOpenAITools(tools: Tool[]): Array<Record<string, unknown>> {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.jsonSchema
    }
  }));
}
