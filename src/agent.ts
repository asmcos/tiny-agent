import OpenAI from "openai";
import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "./config";
import type { AppConfig, ParsedPlanStep } from "./types";
import {
  candidateToolsForPlanStep,
  filterRegisteredTools,
  legacyStepsFromRaw,
  mergePlanTagToolGroups,
  parsePlanDocument
} from "./plan-routing";
import { createProviderRuntime } from "./provider";
import { SkillRegistry, SkillSummary } from "./skills";
import { TraceStore, type TraceStep } from "./trace";
import { buildTools, toOpenAITools, Tool } from "./tools";

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

interface ToolResult {
  output: string;
}

interface ModelIoLogEntry {
  ts: string;
  stage: string;
  data: Record<string, unknown>;
}

const PLAN_RETRY_LIMIT = 2;

export type TinyAgentOptions = {
  /** Full config (skips loading config.json) */
  config?: AppConfig;
  /** Path to config.json (cwd-relative or absolute); ignored if `config` is set */
  configPath?: string;
  /** Toolkit/domain tools appended after `buildTools()` (e.g. `buildRobotTools()` from `toolkits/cars/robot-tools.ts`) */
  extraTools?: Tool[];
  /** When set (e.g. `cars` from `toolkits/run.ts`), planner must emit matching `toolkit:` line; execute uses structured [TAG] → tools */
  activeToolkit?: string;
  /** Domain-specific [TAG]→tools merged with core map in `src/plan-routing.ts`（如 `toolkits/cars/plan-tags.ts`） */
  planTagToolGroups?: Record<string, readonly string[]>;
  /** 无 [TAG] 或未知 TAG 时按自然语言猜工具（可选；领域逻辑放在 toolkit 内） */
  planToolHeuristic?: (instruction: string) => string[] | undefined;
};

export class TinyAgent {
  private readonly config: AppConfig;
  private readonly skills: SkillRegistry;
  private readonly tools: Tool[];
  private readonly toolsByName: Map<string, Tool>;
  private readonly openAITools: Array<Record<string, unknown>>;
  private readonly openAIToolsByName: Map<string, Record<string, unknown>>;
  private readonly trace = new TraceStore();
  private readonly runtime: ReturnType<typeof createProviderRuntime>;
  private readonly planOnly: boolean;
  private readonly toolOutputMaxChars: number;
  /** When true, defer all TRACE printing until the end (`TINY_AGENT_TRACE_BATCH=1`). Default: stream each step as it happens. */
  private readonly traceBatchPrint: boolean;
  private readonly modelIoRunId = `${Date.now()}`;
  private readonly modelIoLogs: ModelIoLogEntry[] = [];
  private readonly activeToolkit?: string;
  private readonly planTagToolMap: Record<string, readonly string[]>;
  private readonly planToolHeuristic?: (instruction: string) => string[] | undefined;

  constructor(opts?: TinyAgentOptions) {
    this.config = opts?.config ?? loadConfig(opts?.configPath);
    this.activeToolkit = opts?.activeToolkit;
    this.planTagToolMap = mergePlanTagToolGroups(opts?.planTagToolGroups);
    this.planToolHeuristic = opts?.planToolHeuristic;
    this.skills = new SkillRegistry(this.config);
    const builtTools = [...buildTools(this.skills), ...(opts?.extraTools ?? [])];
    this.tools = builtTools;
    this.toolsByName = new Map(builtTools.map((t) => [t.name, t]));
    this.openAITools = toOpenAITools(builtTools);
    this.openAIToolsByName = new Map(
      this.openAITools
        .map((t): [string, Record<string, unknown>] => [String((t as { function?: { name?: string } }).function?.name ?? ""), t])
        .filter((x) => Boolean(x[0]))
    );
    this.runtime = createProviderRuntime(this.config);
    this.planOnly = this.config.runtime.planOnly ?? false;
    this.toolOutputMaxChars = this.config.runtime.toolOutputMaxChars ?? 5000;
    this.traceBatchPrint = this.readTraceBatchEnv();
  }

  public async run(userInput: string): Promise<string> {
    this.modelIoLogs.push({
      ts: new Date().toISOString(),
      stage: "run_start",
      data: {
        user_input: userInput,
        model: this.runtime.model,
        active_toolkit: this.activeToolkit ?? null
      },
    });

    const relevantSkills = this.skills.pickRelevant(userInput);
    const { raw: planText, steps } = await this.runPlan(userInput, relevantSkills);

    if (this.planOnly) {
      const traceFile = this.trace.flushToFile();
      const ioLogFile = this.flushModelIoLog();
      if (!this.traceBatchPrint) {
        this.trace.printEndMarker();
      }
      return `${planText}\n\n(trace: ${traceFile})\n(model_io_log: ${ioLogFile})`;
    }

    const skillContext = relevantSkills
      .map((s: SkillSummary) => `[skill:${s.name}]\n${s.summary}`)
      .join("\n\n");

    const baseMessages: Msg[] = [
      {
        role: "system",
        content:
          "你是执行器。你必须调用工具来执行当前步骤，不要只输出描述文本而不调用工具——工具就是你的手和脚。\n" +
          "若当前步骤的 tools 列表里只有一个工具，你必须调用它（哪怕参数按默认值猜测）。\n" +
          "严格按当前步骤执行；可以调用工具，但绝不能伪造工具返回。工具不足时直接说明。\n" +
          "若用户消息含一行 `[PLAN_TAG:XXX]`，表示规划阶段已为本步选定动作类型；请优先选用与该类型一致的工具（本步 API 只会暴露允许列表中的工具）。"
      },
      ...(skillContext ? [{ role: "system" as const, content: `可用技能摘要（按需调用 skill_call 读全文）:\n${skillContext}` }] : []),
      { role: "user", content: `总任务：${userInput}` }
    ];

    const maxPlanSteps = this.config.runtime.maxPlanSteps;
    const cappedSteps = maxPlanSteps ? steps.slice(0, maxPlanSteps) : steps;

    if (cappedSteps.length === 0) {
        const msg = "当前任务无法自动拆分为执行步骤，请按分步指令重新输入。";
        console.log(msg);
        return msg;
      }

    for (let i = 0; i < cappedSteps.length; i++) {
      await this.executeOneStep(baseMessages, cappedSteps[i]!, i, cappedSteps.length);
    }

    const compactFinalContext = this.buildFinalSummaryContext(userInput);
    const completion = await this.createCompletionWithLogging(
      this.buildBaseReq(compactFinalContext, false),
      "final_summary"
    );
    const finalMsg = completion.choices[0]?.message?.content ?? "";

    const finalUsage = this.usageFromCompletion(completion);
    this.tracePush({
      type: "execute",
      model: this.runtime.model,
      prompt: "final summary",
      output: finalMsg,
      ...(finalUsage ? { meta: finalUsage } : {})
    });
    const traceFile = this.trace.flushToFile();
    const ioLogFile = this.flushModelIoLog();
    const tokenSummary = this.trace.summarizeTokenUsage();
    if (this.traceBatchPrint) {
      this.trace.print();
    } else {
      this.trace.printEndMarker();
    }
    const tokenLines = [
      "token_usage:",
      `- prompt_tokens: ${tokenSummary.prompt_tokens}`,
      `- completion_tokens: ${tokenSummary.completion_tokens}`,
      `- total_tokens: ${tokenSummary.total_tokens}`,
      `- cached_prompt_tokens: ${tokenSummary.cached_prompt_tokens}`,
      `- billed_prompt_tokens_est: ${tokenSummary.billed_prompt_tokens_est}`,
      `- reasoning_tokens: ${tokenSummary.reasoning_tokens}`
    ];
    for (const [k, v] of Object.entries(tokenSummary.by_type)) {
      tokenLines.push(
        `- by_${k}: prompt=${v?.prompt_tokens ?? 0}, completion=${v?.completion_tokens ?? 0}, total=${v?.total_tokens ?? 0}, cached=${v?.cached_prompt_tokens ?? 0}, billed_est=${v?.billed_prompt_tokens_est ?? 0}, reasoning=${v?.reasoning_tokens ?? 0}`
      );
    }
    const tokenText = tokenLines.join("\n");
    console.log(`\n=== TOKEN USAGE ===\n${tokenText}`);
    return `${finalMsg}\n\n${tokenText}\n\n(trace: ${traceFile})\n(model_io_log: ${ioLogFile})`;
  }

  private buildFinalSummaryContext(userInput: string): Msg[] {
    const toolSequence = this.trace.getToolSequence();
    const summary = this.trace
      .summarizeSteps()
      .slice(-30)
      .map((x: { type: string; text: string }) => `- [${x.type}] ${x.text}`)
      .join("\n");
    const toolChain = toolSequence.length > 0 ? `\n实际调用的工具链：${toolSequence.join(" → ")}` : "";
    return [
      {
        role: "system",
        content:
          "你是任务总结器。仅基于给定执行摘要做简短中文总结，不调用工具，不补造未发生动作。\n" +
          "特别注意：只有当实际工具链中包含了某动作时，该动作才算真正执行过；仅有 execute 文本记录而无 tool 调用记录则认为该步未实际执行。"
      },
      {
        role: "user",
        content: `总任务：${userInput}\n\n执行摘要：\n${summary || "- 无摘要"}${toolChain}\n\n请输出：完成度（百分比）+ 关键动作。若工具链中缺少关键步骤请如实说明。`
      }
    ];
  }

  private readTraceBatchEnv(): boolean {
    const v = process.env.TINY_AGENT_TRACE_BATCH?.trim().toLowerCase();
    return v === "1" || v === "true" || v === "yes";
  }

  private tracePush(step: TraceStep): void {
    this.trace.add(step);
    if (!this.traceBatchPrint) {
      this.trace.printLastAdded();
    }
  }

  private async createCompletionWithLogging(
    req: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
    stage: string
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    this.modelIoLogs.push({
      ts: new Date().toISOString(),
      stage: `${stage}_request`,
      data: req as unknown as Record<string, unknown>,
    });
    const completion = await this.runtime.client.chat.completions.create(req);
    this.modelIoLogs.push({
      ts: new Date().toISOString(),
      stage: `${stage}_response`,
      data: completion as unknown as Record<string, unknown>,
    });
    return completion;
  }

  private flushModelIoLog(): string {
    const runDir = path.resolve(process.cwd(), "runs");
    fs.mkdirSync(runDir, { recursive: true });
    const filePath = path.join(runDir, `${this.modelIoRunId}.model-io.json`);
    const lines = this.modelIoLogs.map((x) => JSON.stringify(x)).join("\n");
    fs.writeFileSync(filePath, lines ? `${lines}\n` : "", "utf8");
    return filePath;
  }

  private buildBaseReq(
    messages: Msg[],
    allowTools: boolean,
    allowedToolNames?: string[]
  ): OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming {
    const selectedTools = allowTools
      ? allowedToolNames && allowedToolNames.length > 0
        ? allowedToolNames
            .map((n) => this.openAIToolsByName.get(n))
            .filter((x): x is Record<string, unknown> => Boolean(x))
        : this.openAITools
      : undefined;
    return {
      model: this.runtime.model,
      temperature: this.runtime.temperature,
      max_tokens: this.runtime.maxTokens,
      messages: messages,
      tools: selectedTools as unknown as OpenAI.Chat.Completions.ChatCompletionTool[] | undefined,
      tool_choice: allowTools ? "auto" : undefined
    };
  }

  private buildPlannerSystemPrompt(): string {
    const tk = this.activeToolkit?.toLowerCase();
    const head = tk
      ? `当前运行已绑定 **toolkits/${tk}**。规划输出**第一行必须是**单独一行且仅此形式：\ntoolkit: ${tk}\n不得改为其它 toolkit。\n\n`
      : `规划输出**第一行必须是**单独一行，且只能是以下之一（全小写）：\n- toolkit: core\n- toolkit: cars\n- toolkit: fridge\n\ncore=通用文件/shell/技能；cars=小车+机械臂+拍照/视觉；fridge=冰箱规程（可无专用硬件工具）。\n\n`;

    const tagLines = Object.keys(this.planTagToolMap)
      .sort()
      .map((tag) => {
        const tools = this.planTagToolMap[tag]!.join(", ");
        const hint =
          tag === "ANALYZE"
            ? "（仅在完全不知道做什么时使用，禁止用于「规划路径」——路径规划就是 DRIVE）"
            : "";
        return `- [${tag}] — ${tools}${hint}`;
      })
      .join("\n");

    const constraints = tk === "cars"
      ? `\n--- cars 领域硬约束（必须遵守） ---\n` +
        `1. 小车「看不见」：必须先 [CAPTURE] 拍照，再 [VISION] 识别，两者必须成对出现。禁止出现单独的 [VISION] 前没有 [CAPTURE]。\n` +
        `2. 找到物体后直接 [DRIVE] 开过去即可，不要插入 [ANALYZE]——「规划路径」= [DRIVE]。\n` +
        `3. [GRASP] 抓取物体后，如果目标是「放到 X 旁边」，必须再次 [CAPTURE]→[VISION] 定位 X，因为车体移动后旧位置已失效。\n` +
        `4. 每个物体（A / B）的标准流程：CAPTURE → VISION → DRIVE → GRASP/RELEASE。\n`
      : "";

    const body =
      `随后每条步骤单独一行，**格式强制**为：\n` +
      `N. [TAG] 一句中文说明（一步只对应**一个**主 TAG；不要把两类动作写在同一步）。\n\n` +
      `当前运行下允许的标签 TAG 与工具名**严格对应**（勿发明列表外的 TAG；工具名须与下方一致）：\n` +
      `${tagLines}${constraints}\n`;

    return `你是任务规划器。把用户目标拆成步骤；短句、按顺序输出。\n\n${head}${body}`;
  }

  private async runPlan(
    task: string,
    relevantSkills: SkillSummary[]
  ): Promise<{ raw: string; steps: ParsedPlanStep[] }> {
    const skillHints = relevantSkills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
    let raw = "";
    let steps: ParsedPlanStep[] = [];

    for (let attempt = 0; attempt <= PLAN_RETRY_LIMIT; attempt++) {
      let plannerContent = this.buildPlannerSystemPrompt();
      const extraPlanner = this.config.prompts?.planner?.trim();
      if (extraPlanner) {
        plannerContent += `\n\n--- 额外规划约束（来自 config） ---\n${extraPlanner}`;
      }
      const messages: Msg[] = [
        { role: "system", content: plannerContent },
        ...(skillHints ? [{ role: "system" as const, content: `可用技能摘要:\n${skillHints}` }] : []),
        { role: "user", content: task }
      ];
      const completion = await this.createCompletionWithLogging(
        this.buildBaseReq(messages, false),
        `plan_attempt_${attempt + 1}`
      );
      const msg = completion.choices[0]?.message;
      if (!msg) {
        continue;
      }
      raw = msg.content ?? "";
      let parsed = parsePlanDocument(raw);
      let stepList = parsed.steps;
      if (stepList.length === 0) {
        stepList = legacyStepsFromRaw(raw);
      }
      if (stepList.length === 0) {
        // keep steps empty – caller will prompt user for step-by-step input
        stepList = [];
      }
      steps = stepList;

      if (steps.length > 0) {
        const usageMeta = this.usageFromCompletion(completion);
        const effectiveToolkit = (this.activeToolkit ?? parsed.declaredToolkit ?? "core").toLowerCase();
        const planMeta: Record<string, unknown> = {
          declared_toolkit: parsed.declaredToolkit,
          effective_toolkit: effectiveToolkit
        };
        if (usageMeta) Object.assign(planMeta, usageMeta);
        this.tracePush({
          type: "plan",
          model: this.runtime.model,
          prompt: task,
          output: raw,
          meta: planMeta
        });
        return { raw, steps };
      }
    }

    if (steps.length === 0) {
      steps = [];
    }
    return { raw, steps };
  }

  private async executeOneStep(
    baseMessages: Msg[],
    parsed: ParsedPlanStep,
    index: number,
    total: number
  ): Promise<void> {
    const stepMessages: Msg[] = [...baseMessages];
    const tagLine = parsed.planTag ? `\n[PLAN_TAG:${parsed.planTag}]` : "";

    if (parsed.planTag === "DRIVE" || parsed.planTag === "GRASP" || parsed.planTag === "RELEASE") {
      const visionOutput = this.trace.getLastToolOutput("vision_detect");
      const captureOutput = this.trace.getLastToolOutput("camera_capture");
      const parts: string[] = [];
      if (visionOutput) parts.push(`最新视觉检测结果：${visionOutput}`);
      if (captureOutput) parts.push(`最新拍照结果：${captureOutput}`);
      if (parts.length > 0) {
        stepMessages.push({ role: "system", content: `上一步感知数据（供本步参考）：\n${parts.join("\n")}` });
      }
    }

    stepMessages.push({
      role: "user",
      content: `[步骤 ${index + 1}/${total}] ${parsed.instruction}${tagLine}`
    });

    let retryCount = 0;
    const maxRetries = 5;
    const allowedToolNames = this.pickToolsForParsedStep(parsed);

    while (retryCount < maxRetries) {
      const completion = await this.createCompletionWithLogging(
        this.buildBaseReq(this.trimMessages(stepMessages), true, allowedToolNames),
        `execute_step_${index + 1}_round_${retryCount + 1}`
      );

      const msg = completion.choices[0]?.message;
      if (!msg) break;

      // Ensure tool_calls is handled correctly for the next message
      const assistantMsg: any = {
        role: "assistant",
        content: msg.content || null
      };
      // Some reasoning models require `reasoning_content` to be sent back in follow-up requests.
      if ((msg as any).reasoning_content) {
        assistantMsg.reasoning_content = (msg as any).reasoning_content;
      }
      if (msg.tool_calls) {
        assistantMsg.tool_calls = msg.tool_calls;
      }
      stepMessages.push(assistantMsg);

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        for (const tc of msg.tool_calls) {
          const result = await this.callTool(tc);
          const toolName = "function" in tc && tc.function.name ? tc.function.name : "unknown_tool";
          const toolArgs = "function" in tc ? tc.function.arguments : "{}";

          // OpenAI-compatible tool response message.
          // DeepSeek requires `role: "tool"` + `tool_call_id` for each tool_call.
          stepMessages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: result.output
          } as any);

          this.tracePush({
            type: "tool",
            prompt: `${toolName}(${toolArgs})`,
            output: result.output
          });
        }
        retryCount++;
      } else {
        const stepUsage = this.usageFromCompletion(completion);
        const execMeta: Record<string, unknown> = {
          plan_tag: parsed.planTag,
          allowed_tools: allowedToolNames
        };
        if (stepUsage) Object.assign(execMeta, stepUsage);
        this.tracePush({
          type: "execute",
          model: this.runtime.model,
          prompt: parsed.rawLine,
          output: msg.content ?? "",
          meta: execMeta
        });
        break;
      }
    }
  }

  private pickToolsForParsedStep(parsed: ParsedPlanStep): string[] {
    const names = candidateToolsForPlanStep(parsed, this.planTagToolMap, this.planToolHeuristic);
    return filterRegisteredTools(names, (n) => this.toolsByName.has(n));
  }

  private usageFromCompletion(completion: unknown): Record<string, unknown> | undefined {
    const c = completion as {
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
        completion_tokens_details?: { reasoning_tokens?: number };
      };
    };
    const u = c?.usage;
    if (!u) return undefined;
    const cached = Number(u.prompt_tokens_details?.cached_tokens ?? 0);
    const reasoning = Number(u.completion_tokens_details?.reasoning_tokens ?? 0);
    if (u.prompt_tokens == null && u.completion_tokens == null && u.total_tokens == null && !cached && !reasoning) {
      return undefined;
    }
    return {
      prompt_tokens: u.prompt_tokens,
      completion_tokens: u.completion_tokens,
      total_tokens: u.total_tokens,
      cached_prompt_tokens: cached,
      billed_prompt_tokens_est: Math.max(0, Number(u.prompt_tokens ?? 0) - cached),
      reasoning_tokens: reasoning
    };
  }

  private readonly toolAliases: Record<string, string> = {
    "camera_camera": "camera_capture",
    "car_move": "car_control",
    "arm_grab": "arm_grasp",
    "arm_drop": "arm_release",
    "take_photo": "camera_capture",
    "capture_image": "camera_capture"
  };

  private async callTool(tc: any): Promise<ToolResult> {
    let toolName = tc.function?.name;
    if (!toolName) {
      return { output: "Error: Tool name is missing" };
    }
    const aliased = this.toolAliases[toolName];
    if (aliased && this.toolsByName.has(aliased)) {
      toolName = aliased;
    }
    const tool = this.toolsByName.get(toolName);
    if (!tool) {
      return { output: `Error: Tool ${toolName} not found` };
    }

    try {
      const args = JSON.parse(tc.function.arguments || "{}");
      const output = await tool.run(args);
      let maxChars = this.toolOutputMaxChars;
      if (toolName === "vision_detect") maxChars = Math.min(maxChars, 600);
      if (toolName === "skill_call") maxChars = Math.min(maxChars, 800);
      return { output: this.truncateOutput(String(output), maxChars) };
    } catch (e) {
      return { output: `Error: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  private trimMessages(messages: Msg[]): Msg[] {
    const maxTotal = this.config.runtime.contextWindow ?? 16;
    if (messages.length <= maxTotal) return messages;

    const systemMsgs = messages.filter((m) => m.role === "system");
    const otherMsgs = messages.filter((m) => m.role !== "system");
    const maxOther = Math.max(1, maxTotal - systemMsgs.length);

    // DeepSeek/OpenAI requires: every `role: tool` must be a response to a preceding
    // `assistant` message that contains the corresponding `tool_calls`.
    // When trimming, we must keep the tool-call + its tool responses as a group.
    const keptReversed: Msg[] = [];
    let keptCount = 0;

    // Walk backwards and keep messages; if we keep a `tool` message, we must also keep
    // the nearest preceding `assistant` that had tool_calls.
    let needPrevAssistantForTool = false;
    for (let i = otherMsgs.length - 1; i >= 0; i--) {
      const m = otherMsgs[i];
      keptReversed.push(m);
      keptCount++;

      if (m.role === "tool") {
        needPrevAssistantForTool = true;
      }

      if (needPrevAssistantForTool) {
        // Keep moving backwards until we include an assistant tool_calls message.
        const isAssistantWithToolCalls =
          m.role === "assistant" && Array.isArray((m as any).tool_calls) && (m as any).tool_calls.length > 0;
        if (isAssistantWithToolCalls) {
          needPrevAssistantForTool = false;
        }
      }

      // Stop when we reached target size and we're not in the middle of a tool-response chain.
      if (keptCount >= maxOther && !needPrevAssistantForTool) {
        break;
      }
    }

    const keptOther = keptReversed.reverse();
    return [...systemMsgs, ...keptOther];
  }

  private truncateOutput(output: string, maxChars = this.toolOutputMaxChars): string {
    if (output.length <= maxChars) return output;
    const head = output.slice(0, Math.floor(maxChars * 0.7));
    const tail = output.slice(-Math.floor(maxChars * 0.2));
    return `${head}\n...[trimmed ${output.length - head.length - tail.length} chars]...\n${tail}`;
  }
}
