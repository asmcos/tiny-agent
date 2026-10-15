import { spawn } from "node:child_process";
import { AppError } from "../../shared/errors";
import type { ToolDefinition, ToolResult } from "../contracts";

const MAX_OUTPUT = 30_000;

function fail(error: AppError): ToolResult {
  return { ok: false, output: `${error.code}: ${error.message}`, error };
}

function blocked(argv: string[]): string | null {
  const joined = argv.join(" ");
  if (/(^|\s)rm\s+(-[a-zA-Z]*r[a-zA-Z]*f|--recursive)[^\n]*\s\/(\s|$)/.test(joined)) {
    return "拒绝删除根目录";
  }
  if (/\b(mkfs|shutdown|reboot|dd)\b/.test(argv[0] ?? "")) {
    return "拒绝高危系统命令";
  }
  return null;
}

export function terminalRunTool(defaultTimeoutMs: number): ToolDefinition {
  return {
    name: "terminal.run",
    description: "在工作区目录执行命令。参数是 argv 数组，不经过 shell 拼接。",
    risk: "process",
    timeoutMs: defaultTimeoutMs,
    inputSchema: {
      type: "object",
      properties: {
        argv: { type: "array" },
        timeoutSeconds: { type: "integer" }
      },
      required: ["argv"]
    },
    async execute(input, ctx) {
      const argv = input.argv;
      if (!Array.isArray(argv) || argv.length === 0 || argv.some((part) => typeof part !== "string")) {
        return fail(new AppError("TOOL_INPUT_INVALID", "argv 必须是非空字符串数组"));
      }
      const deny = blocked(argv as string[]);
      if (deny) return fail(new AppError("PERMISSION_DENIED", deny));
      const timeoutMs =
        typeof input.timeoutSeconds === "number" ? input.timeoutSeconds * 1000 : defaultTimeoutMs;
      try {
        const output = await runProcess(argv as string[], ctx.workspaceRoot, timeoutMs, ctx.signal);
        return output;
      } catch (error) {
        return fail(error instanceof AppError ? error : new AppError("COMMAND_FAILED", String(error)));
      }
    }
  };
}

export function runProcess(
  argv: string[],
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal
): Promise<ToolResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ToolResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(result);
    };
    const child = spawn(argv[0]!, argv.slice(1), { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish(fail(new AppError("COMMAND_TIMEOUT", `命令超时（${timeoutMs}ms）`)));
    }, timeoutMs);
    const onAbort = () => {
      child.kill("SIGKILL");
      finish(fail(new AppError("TASK_CANCELLED", "命令已取消")));
    };
    if (signal.aborted) onAbort();
    signal.addEventListener("abort", onAbort);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      finish(fail(new AppError("COMMAND_FAILED", error.message)));
    });
    child.on("close", (code) => {
      const body = [`exit=${code ?? "null"}`, clip(stdout), clip(stderr)].filter(Boolean).join("\n");
      if (code === 0) finish({ ok: true, output: body, data: { exitCode: 0 } });
      else {
        finish({
          ok: false,
          output: body,
          data: { exitCode: code },
          error: new AppError("COMMAND_FAILED", `退出码 ${code}`)
        });
      }
    });
  });
}

function clip(text: string): string {
  if (text.length <= MAX_OUTPUT) return text;
  return `${text.slice(0, MAX_OUTPUT)}\n…(输出已截断)`;
}

export function gitStatusTool(): ToolDefinition {
  return gitTool("git.status", ["status", "--short"], "查看 git status --short");
}

export function gitDiffTool(): ToolDefinition {
  return gitTool("git.diff", ["diff", "--"], "查看 git diff");
}

export function processListTool(): ToolDefinition {
  return {
    name: "process.list",
    description: "列出当前系统进程的 pid 和命令名，最多 80 行。",
    permission: "read_only",
    risk: "read_only",
    timeoutMs: 8_000,
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute(_input, ctx) {
      const result = await runProcess(["ps", "-eo", "pid,comm"], ctx.workspaceRoot, 8_000, ctx.signal);
      if (!result.ok) return result;
      const lines = result.output.split("\n").slice(0, 81);
      return { ...result, output: lines.join("\n") };
    }
  };
}

export function testRunTool(defaultTimeoutMs: number): ToolDefinition {
  return {
    name: "test.run",
    description: "在工作区执行测试命令，返回退出码。失败时附上输出末尾作为失败摘要。",
    permission: "process",
    risk: "process",
    timeoutMs: defaultTimeoutMs,
    inputSchema: {
      type: "object",
      properties: { argv: { type: "array" } },
      required: ["argv"]
    },
    async execute(input, ctx) {
      const argv = input.argv;
      if (!Array.isArray(argv) || argv.some((part) => typeof part !== "string") || argv.length === 0) {
        return fail(new AppError("TOOL_INPUT_INVALID", "argv 必须是非空字符串数组"));
      }
      const deny = blocked(argv as string[]);
      if (deny) return fail(new AppError("PERMISSION_DENIED", deny));
      const result = await runProcess(argv as string[], ctx.workspaceRoot, defaultTimeoutMs, ctx.signal);
      const lines = result.output.split("\n");
      const tail = lines.slice(-40).join("\n");
      const exit = result.ok ? 0 : "非 0";
      return {
        ...result,
        output: `exit=${exit}\n${result.ok ? "summary: passed" : `summary:\n${tail}`}`
      };
    }
  };
}

function gitTool(name: string, args: string[], description: string): ToolDefinition {
  return {
    name,
    description,
    risk: "read_only",
    timeoutMs: 15_000,
    inputSchema: { type: "object", properties: {}, required: [] },
    async execute(_input, ctx) {
      const result = await runProcess(["git", ...args], ctx.workspaceRoot, 15_000, ctx.signal);
      return result;
    }
  };
}
