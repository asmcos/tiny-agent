import fs from "node:fs";
import path from "node:path";
import type OpenAI from "openai";
import { loadConfig, tryLoadConfig } from "./config";
import { Tool, tool } from "./base-tool";
import { AgentMaxStepsError } from "./errors";
import { AgentLogger, LogLevel } from "./monitoring";
import { OpenAIServerModel } from "./model";
import { TraceStore, type TraceStep } from "./trace";
import { buildPlanStepUserContent } from "./plan-step-scope";
import {
  candidateToolsForPlanStep,
  filterRegisteredTools,
  legacyStepsFromRaw,
  parsePlanDocument
} from "./plan-routing";
import type { AppConfig, ParsedPlanStep } from "./types";
import { formatRunTokenUsagePlaintext, type UiFormat } from "./ui";

export { tool };

export type ToolCallingAgentOptions = {
  tools: Tool[];
  model?: OpenAIServerModel;
  config?: AppConfig;
  configPath?: string;
  maxSteps?: number;
  /** 正整数：第 1 步及之后每 N 步先调规划 LLM（smolagents `planningInterval` 语义） */
  planningInterval?: number;
  instructions?: string;
  contextWindow?: number;
  toolOutputMaxChars?: number;
  ui?: { format?: UiFormat };
  verbosityLevel?: LogLevel;
  /** 为 true 时：先规划拆解，再按编号逐步执行；每步工具由模型根据规划句自行选择 */
  planStepMode?: boolean;
  /** 规划第一行 `toolkit:` 须与此一致（如 `cars`） */
  activeToolkit?: string;
  /**
   * 为 true 时按步限制 API 工具（仅当规划行含 [TAG] 且提供 planTagToolGroups 时生效）。
   * 默认 false：只下发规划句，不替模型规定工具。
   */
  restrictToolsPerPlanStep?: boolean;
  /** 与 restrictToolsPerPlanStep 联用：[TAG] → 工具名 */
  planTagToolGroups?: Record<string, readonly string[]>;
  /** restrict 模式下：带 [TAG] 且成功调用允许工具后即进入下一步 */
  completePlanStepAfterToolCalls?: boolean;
  /** 每规划步最多 LLM 轮数（默认 config.runtime.maxStepRounds） */
  maxRoundsPerPlanStep?: number;
};

type Msg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/** DeepSeek 等 thinking 模式要求把 `reasoning_content` 原样带回后续请求（对齐 tiny-agent-origin）。 */
function toAssistantMessage(msg: OpenAI.Chat.Completions.ChatCompletionMessage): Msg {
  const reasoning = (msg as { reasoning_content?: string }).reasoning_content;
  const assistant: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
    role: "assistant",
    content: msg.content ?? null,
    ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}),
    ...(reasoning ? { reasoning_content: reasoning } : {})
  };
  return assistant;
}

function toOpenAITools(tools: Tool[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.jsonSchema
    }
  }));
}

function usageFromCompletion(completion: OpenAI.Chat.Completions.ChatCompletion): Record<string, unknown> | undefined {
  const u = completion.usage;
  if (!u) return undefined;
  const cached = Number(u.prompt_tokens_details?.cached_tokens ?? 0);
  const reasoning = Number(u.completion_tokens_details?.reasoning_tokens ?? 0);
  return {
    prompt_tokens: u.prompt_tokens,
    completion_tokens: u.completion_tokens,
    total_tokens: u.total_tokens,
    cached_prompt_tokens: cached,
    billed_prompt_tokens_est: Math.max(0, Number(u.prompt_tokens ?? 0) - cached),
    reasoning_tokens: reasoning
  };
}

function createFinalAnswerTool(): Tool {
  return tool(
    {
      name: "final_answer",
      description: "Return the final answer to the user and end the run.",
      inputs: {
        answer: { type: "string", description: "Final answer text." }
      },
      outputType: "string"
    },
    async ({ answer }) => String(answer)
  );
}

/**
 * 自实现多步智能体（思想对齐 smolagents MultiStepAgent / ToolCallingAgent）：
 * 可选 planningInterval → 规划步；每步 model + tools；final_answer 结束。
 * 配置与 trace UI 对齐 tiny-agent-origin。
 */
export class ToolCallingAgent {
  private readonly appConfig?: AppConfig;
  private readonly model: OpenAIServerModel;
  private readonly tools: Map<string, Tool>;
  private readonly maxSteps: number;
  private readonly planningInterval?: number;
  private readonly instructions: string;
  private readonly plannerExtra: string;
  private readonly contextWindow: number;
  private readonly toolOutputMaxChars: number;
  private readonly trace: TraceStore;
  private readonly logger: AgentLogger;
  private readonly traceBatch: boolean;
  private readonly modelIoRunId = `${Date.now()}`;
  private readonly modelIoLogs: Array<{ ts: string; stage: string; data: unknown }> = [];
  private readonly planStepMode: boolean;
  private readonly planTagToolMap: Record<string, readonly string[]>;
  private readonly completePlanStepAfterToolCalls: boolean;
  private readonly activeToolkit?: string;
  private readonly maxRoundsPerPlanStep: number;
  private readonly planOnly: boolean;
  private readonly restrictToolsPerPlanStep: boolean;

  constructor(opts: ToolCallingAgentOptions) {
    let appConfig: AppConfig | undefined;
    if (opts.config) {
      appConfig = opts.config;
    } else if (opts.configPath != null && opts.configPath !== "") {
      appConfig = loadConfig(opts.configPath);
    } else if (!opts.model) {
      appConfig = loadConfig();
    } else {
      appConfig = tryLoadConfig();
    }
    this.appConfig = appConfig;

    this.model = opts.model ?? OpenAIServerModel.fromAppConfig(appConfig!);

    const rt = appConfig?.runtime;
    this.maxSteps = opts.maxSteps ?? rt?.maxStepRounds ?? 12;
    const intervalRaw = opts.planningInterval ?? rt?.planningInterval;
    this.planningInterval =
      intervalRaw != null && Number(intervalRaw) > 0 ? Math.floor(Number(intervalRaw)) : undefined;

    const instParts = [opts.instructions?.trim(), appConfig?.prompts?.executor?.trim()].filter(Boolean);
    this.instructions = instParts.join("\n\n");
    this.plannerExtra = appConfig?.prompts?.planner?.trim() ?? "";

    this.contextWindow = opts.contextWindow ?? rt?.contextWindow ?? 24;
    this.toolOutputMaxChars = opts.toolOutputMaxChars ?? rt?.toolOutputMaxChars ?? 4000;
    this.planOnly = rt?.planOnly ?? false;
    this.maxRoundsPerPlanStep = opts.maxRoundsPerPlanStep ?? rt?.maxStepRounds ?? 5;

    this.planStepMode = opts.planStepMode ?? false;
    this.restrictToolsPerPlanStep = opts.restrictToolsPerPlanStep ?? false;
    this.planTagToolMap = { ...(opts.planTagToolGroups ?? {}) };
    this.completePlanStepAfterToolCalls = opts.completePlanStepAfterToolCalls ?? false;
    this.activeToolkit = opts.activeToolkit;

    this.trace = new TraceStore(opts.ui?.format);
    this.logger = new AgentLogger(opts.verbosityLevel ?? LogLevel.INFO, opts.ui?.format);
    this.traceBatch = ["1", "true", "yes"].includes(
      (process.env.TINY_AGENT_TRACE_BATCH ?? "").trim().toLowerCase()
    );

    const all = this.planStepMode ? opts.tools : [...opts.tools, createFinalAnswerTool()];
    this.tools = new Map(all.map((t) => [t.name, t]));
  }

  async run(task: string, opts: { reset?: boolean } = {}): Promise<string> {
    if (opts.reset !== false) {
      this.trace.reset();
    }

    this.modelIoLogs.push({
      ts: new Date().toISOString(),
      stage: "run_start",
      data: {
        task: task.slice(0, 2000),
        model: this.model.modelId,
        planningInterval: this.planningInterval ?? null,
        plan_step_mode: this.planStepMode
      }
    });

    this.logger.logTask(task.trim(), this.model.modelId);

    if (this.planStepMode) {
      return this.runWithPlanSteps(task);
    }

    const system =
      "你是工具型智能体：通过调用工具完成任务，不要编造工具结果。\n" +
      "完成时调用 final_answer，传入最终答复。\n" +
      (this.instructions ? `\n${this.instructions}` : "");

    const messages: Msg[] = [
      { role: "system", content: system },
      { role: "user", content: task }
    ];

    let finalAnswer: string | undefined;

    for (let step = 1; step <= this.maxSteps; step++) {
      if (this.shouldPlan(step)) {
        const plan = await this.generatePlanningStep(task, messages, step === 1, step);
        this.pushTrace({
          type: "plan",
          model: this.model.modelId,
          prompt: step === 1 ? task : `[replan @ step ${step}] ${task}`,
          output: plan,
          meta: {
            mid_run_replan: step > 1,
            replan_at_execute_step: step > 1 ? step : undefined,
            planning_interval: this.planningInterval ?? null
          }
        });
        messages.push({
          role: "assistant",
          content: `Plan:\n${plan}`
        });
        messages.push({
          role: "user",
          content: "Now proceed and carry out this plan using the available tools."
        });
      }

      this.logger.logStep(step, this.maxSteps);

      const completion = await this.chat(messages, `step_${step}`, true);
      const msg = completion.choices[0]?.message;
      if (!msg) break;

      const usage = usageFromCompletion(completion);
      this.pushTrace({
        type: "model_turn",
        model: this.model.modelId,
        prompt: `step ${step}`,
        output: (msg.content && String(msg.content).trim()) || "（tool_calls）",
        meta: { step, step_total: this.maxSteps, ...(usage ?? {}) }
      });

      messages.push(toAssistantMessage(msg));

      if (!msg.tool_calls?.length) {
        finalAnswer = msg.content ?? "";
        this.pushTrace({
          type: "execute",
          model: this.model.modelId,
          prompt: `step ${step}`,
          output: finalAnswer,
          meta: { step, step_total: this.maxSteps, phase: "text_only" }
        });
        break;
      }

      const observations: string[] = [];
      for (const tc of msg.tool_calls) {
        if (tc.type !== "function" || !("function" in tc)) continue;
        const name = tc.function.name ?? "unknown";
        const argsRaw = tc.function.arguments ?? "{}";
        const output = await this.invokeTool(name, argsRaw);

        observations.push(`Tool '${name}': ${output}`);
        this.pushTrace({
          type: "tool",
          prompt: `${name}(${argsRaw})`,
          output
        });

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: output
        } as Msg);

        if (name === "final_answer") {
          try {
            const parsed = JSON.parse(argsRaw) as { answer?: string };
            finalAnswer = parsed.answer ?? output;
          } catch {
            finalAnswer = output;
          }
          this.pushTrace({
            type: "execute",
            model: this.model.modelId,
            prompt: `step ${step}`,
            output: `Observations:\n${observations.join("\n")}`,
            meta: { step, step_total: this.maxSteps, phase: "final_answer", is_final: true }
          });
          this.logger.logFinalAnswer(finalAnswer);
          return this.finish(finalAnswer);
        }
      }

      this.pushTrace({
        type: "execute",
        model: this.model.modelId,
        prompt: `step ${step}`,
        output: observations.length ? `Observations:\n${observations.join("\n")}` : "(no tool output)",
        meta: { step, step_total: this.maxSteps, phase: "after_tools" }
      });
    }

    if (!finalAnswer) {
      throw new AgentMaxStepsError(this.maxSteps);
    }

    this.logger.logFinalAnswer(finalAnswer);
    return this.finish(finalAnswer);
  }

  /**
   * 首轮必规划（对齐 tiny-agent-origin TinyAgent）。
   * 中途 replan：仅当 `planningInterval` > 0，且 (step-1) % N === 0（对齐 smolagents）。
   */
  private shouldPlan(stepNumber: number): boolean {
    if (stepNumber === 1) return true;
    if (!this.planningInterval) return false;
    return (stepNumber - 1) % this.planningInterval === 0;
  }

  private async generatePlanningStep(
    task: string,
    history: Msg[],
    isFirstStep: boolean,
    stepNumber: number,
    completedPlanSteps?: ParsedPlanStep[],
    remainingStepBudget?: number
  ): Promise<string> {
    let plannerSystem =
      "你是任务规划器。用简短中文列出剩余步骤（编号列表即可），不要调用工具。\n" +
      "尽量让每个规划步对应 toolkit 中**一种**可执行能力；一步一事，避免把移动与拾取/放下写在同一步。\n" +
      "按用户任务拆步，勿编造用户未提到的目标；若任务含搬运到第二地点，第二段感知须在拾取之后（见 planner 附录）。\n" +
      (isFirstStep
        ? "针对完整任务做首轮拆解。\n"
        : `当前即将执行第 ${stepNumber} 步，请根据已有对话更新**剩余**计划，勿重复已完成部分。\n`);
    if (this.activeToolkit) {
      plannerSystem += `第一行须为 toolkit: ${this.activeToolkit}\n`;
    }
    if (this.plannerExtra) {
      plannerSystem += `\n${this.plannerExtra}`;
    }

    const completedNote =
      completedPlanSteps?.length ?
        `\n\n已完成步骤：\n${completedPlanSteps.map((s, i) => `${i + 1}. ${s.instruction}`).join("\n")}`
      : "";
    const budgetNote =
      remainingStepBudget != null ?
        `\n剩余步骤预算：最多 ${remainingStepBudget} 条。`
      : "";

    const planMessages: Msg[] = [
      { role: "system", content: plannerSystem },
      ...history.filter((m) => m.role !== "system"),
      {
        role: "user",
        content:
          isFirstStep ? `任务：\n${task}`
          : `请更新剩余计划。原始任务：\n${task}${completedNote}${budgetNote}`
      }
    ];

    const completion = await this.chat(planMessages, `plan_${stepNumber}`, false);
    return completion.choices[0]?.message?.content?.trim() ?? "";
  }

  private async invokeTool(name: string, argsRaw: string): Promise<string> {
    const t = this.tools.get(name);
    if (!t) return `Error: unknown tool '${name}'`;
    try {
      const args = JSON.parse(argsRaw || "{}") as Record<string, unknown>;
      return this.truncate(await t.call(args));
    } catch (e) {
      return `Error: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  private async runWithPlanSteps(task: string): Promise<string> {
    const plan = await this.generatePlanningStep(task, [], true, 1);
    this.pushTrace({
      type: "plan",
      model: this.model.modelId,
      prompt: task,
      output: plan,
      meta: { planning_interval: this.planningInterval ?? null, active_toolkit: this.activeToolkit ?? null }
    });

    if (this.planOnly) {
      return this.finish(plan);
    }

    const { declaredToolkit, steps: parsed } = parsePlanDocument(plan);
    let steps = parsed.length > 0 ? parsed : legacyStepsFromRaw(plan);
    const maxPlanSteps = this.appConfig?.runtime.maxPlanSteps;
    if (maxPlanSteps && maxPlanSteps > 0) {
      steps = steps.slice(0, maxPlanSteps);
    }

    if (steps.length === 0) {
      return this.finish("无法从规划中解析出执行步骤，请重新描述任务。");
    }

    if (
      this.activeToolkit &&
      declaredToolkit &&
      declaredToolkit !== this.activeToolkit.toLowerCase()
    ) {
      this.logger.logTask(
        `规划声明 toolkit:${declaredToolkit} 与 activeToolkit:${this.activeToolkit} 不一致，仍按解析步骤执行。`,
        this.model.modelId
      );
    }

    const executorReplanNote = this.planningInterval
      ? `若已开启 planning_interval（每 ${this.planningInterval} 步），执行中途可能自动更新后续步骤。\n`
      : "本流程默认不在执行中途自动重新规划；步骤列表在首轮规划后固定。\n";

    const baseMessages: Msg[] = [
      {
        role: "system",
        content:
          "你是**执行器**（不是规划器）：只落实「当前这一条用户消息」里的动作，必须按需调用工具完成它。\n" +
          executorReplanNote +
          "你必须调用工具来执行当前步骤，不要只输出描述文本而不调用工具。\n" +
          "每条【执行 k/n】只对应规划第 k 步：即使已抵达目标，也不要在本步拾取/放下/再拍照，除非本步描述明确要求。\n" +
          "严格按当前步骤执行；可以调用工具，但绝不能伪造工具返回。\n" +
          (this.restrictToolsPerPlanStep ?
            "本运行已开启按步限工具：仅使用当前步骤允许列表中的工具。\n"
          : "本运行不限制每步工具种类：根据当前步骤描述自行选用合适工具。\n") +
          (this.instructions ? `\n${this.instructions}` : "")
      },
      { role: "user", content: task }
    ];

    let i = 0;
    while (i < steps.length) {
      const stepNumber = i + 1;
      if (this.shouldReplanBeforePlanStep(stepNumber)) {
        const remainingBudget = maxPlanSteps ? Math.max(0, maxPlanSteps - i) : undefined;
        const replan = await this.generatePlanningStep(
          task,
          baseMessages,
          false,
          stepNumber,
          steps.slice(0, i),
          remainingBudget
        );
        const tail = parsePlanDocument(replan).steps;
        const legacyTail = tail.length > 0 ? tail : legacyStepsFromRaw(replan);
        if (legacyTail.length > 0) {
          steps = [...steps.slice(0, i), ...legacyTail];
          if (maxPlanSteps && maxPlanSteps > 0) steps = steps.slice(0, maxPlanSteps);
          this.pushTrace({
            type: "plan",
            model: this.model.modelId,
            prompt: `[replan @ step ${stepNumber}] ${task}`,
            output: replan,
            meta: {
              mid_run_replan: true,
              replan_at_execute_step: stepNumber,
              planning_interval: this.planningInterval ?? null
            }
          });
        }
      }

      const stepBrief = await this.executeOnePlanStep(baseMessages, steps, i);
      if (stepBrief) {
        baseMessages.push({
          role: "user",
          content: `【步骤 ${i + 1} 已完成】${stepBrief}`
        });
      }
      i++;
    }

    const summary = await this.generateFinalSummary(task);
    this.logger.logFinalAnswer(summary);
    return this.finish(summary);
  }

  private shouldReplanBeforePlanStep(stepNumber: number): boolean {
    if (!this.planningInterval) return false;
    if (stepNumber <= 1) return false;
    return (stepNumber - 1) % this.planningInterval === 0;
  }

  private pickToolsForParsedStep(parsed: ParsedPlanStep): string[] {
    const names = candidateToolsForPlanStep(parsed, this.planTagToolMap);
    return filterRegisteredTools(names, (n) => this.tools.has(n));
  }

  private async executeOnePlanStep(
    baseMessages: Msg[],
    steps: ParsedPlanStep[],
    index: number
  ): Promise<string> {
    const parsed = steps[index]!;
    const total = steps.length;
    const stepMessages: Msg[] = [...baseMessages];
    const allowedToolNames = this.restrictToolsPerPlanStep ? this.pickToolsForParsedStep(parsed) : [];
    const allowedNote =
      this.restrictToolsPerPlanStep ?
        allowedToolNames.length > 0 ?
          `\n【本步仅此工具】${allowedToolNames.join(", ")}（来自规划 [TAG]）。`
        : "\n（本步无 [TAG]，不限工具；请根据描述自行选择。）"
      : "";

    const stepUserContent = buildPlanStepUserContent(parsed, index, steps) + allowedNote;
    const toolsForChat = this.restrictToolsPerPlanStep ? allowedToolNames : undefined;

    stepMessages.push({
      role: "user",
      content: stepUserContent
    });

    const toolOutputs: string[] = [];

    const calledThisStep = new Set<string>();
    let round = 0;

    while (round < this.maxRoundsPerPlanStep) {
      const completion = await this.chat(
        stepMessages,
        `execute_step_${index + 1}_round_${round + 1}`,
        true,
        toolsForChat
      );
      const msg = completion.choices[0]?.message;
      if (!msg) break;

      const usage = usageFromCompletion(completion);
      if (msg.tool_calls?.length) {
        const toolNames = msg.tool_calls
          .map((tc) => ("function" in tc && tc.function?.name ? tc.function.name : "?"))
          .join(", ");
        this.pushTrace({
          type: "model_turn",
          model: this.model.modelId,
          prompt: stepUserContent,
          output:
            (msg.content && String(msg.content).trim()) ||
            `（tool_calls: ${toolNames}）`,
          meta: {
            execute_step: index + 1,
            execute_step_total: total,
            round: round + 1,
            plan_tag: parsed.planTag,
            allowed_tools: this.restrictToolsPerPlanStep ? allowedToolNames : null,
            tool_calls: toolNames,
            ...(usage ?? {})
          }
        });
      }

      stepMessages.push(toAssistantMessage(msg));

      if (!msg.tool_calls?.length) {
        if (calledThisStep.size === 0 && round === 0) {
          stepMessages.push({
            role: "user",
            content: "请调用工具完成本步，不要仅用文字描述。"
          });
          round++;
          continue;
        }
        this.pushTrace({
          type: "execute",
          model: this.model.modelId,
          prompt: parsed.rawLine,
          output: msg.content ?? "",
          meta: {
            execute_step: index + 1,
            execute_step_total: total,
            round: round + 1,
            phase: "step_done",
            plan_tag: parsed.planTag,
            allowed_tools: this.restrictToolsPerPlanStep ? allowedToolNames : null,
            ...(usage ?? {})
          }
        });
        break;
      }

      let ranAllowedTool = false;
      for (const tc of msg.tool_calls) {
        if (tc.type !== "function" || !("function" in tc)) continue;
        const name = tc.function.name ?? "unknown";
        const argsRaw = tc.function.arguments ?? "{}";

        if (this.restrictToolsPerPlanStep && !allowedToolNames.includes(name)) {
          const reject =
            `Error: 工具「${name}」不属于本步【${index + 1}/${total}】。` +
            `本步仅允许：${allowedToolNames.join(", ") || "（无）"}。`;
          stepMessages.push({ role: "tool", tool_call_id: tc.id, content: reject } as Msg);
          this.pushTrace({ type: "tool", prompt: `${name}(${argsRaw})`, output: reject });
          continue;
        }

        ranAllowedTool = true;
        const output = await this.invokeTool(name, argsRaw);
        calledThisStep.add(name);
        toolOutputs.push(`${name}: ${output.slice(0, 500)}`);
        stepMessages.push({ role: "tool", tool_call_id: tc.id, content: output } as Msg);
        this.pushTrace({ type: "tool", prompt: `${name}(${argsRaw})`, output });
      }

      round++;

      if (!this.restrictToolsPerPlanStep) {
        continue;
      }

      if (this.completePlanStepAfterToolCalls && parsed.planTag && ranAllowedTool) {
        this.pushTrace({
          type: "execute",
          model: this.model.modelId,
          prompt: parsed.rawLine,
          output: "（本步已执行允许的工具，进入下一步）",
          meta: {
            execute_step: index + 1,
            execute_step_total: total,
            round,
            phase: "step_done_after_tools",
            plan_tag: parsed.planTag,
            allowed_tools: allowedToolNames
          }
        });
        break;
      }

      if (
        allowedToolNames.length > 0 &&
        allowedToolNames.every((t) => calledThisStep.has(t))
      ) {
        this.pushTrace({
          type: "execute",
          model: this.model.modelId,
          prompt: parsed.rawLine,
          output: "（本步所需工具均已调用，进入下一步）",
          meta: {
            execute_step: index + 1,
            execute_step_total: total,
            round,
            phase: "step_done_all_required_tools",
            allowed_tools: allowedToolNames
          }
        });
        break;
      }

      if (allowedToolNames.length === 1 && ranAllowedTool) {
        this.pushTrace({
          type: "execute",
          model: this.model.modelId,
          prompt: parsed.rawLine,
          output: "（单工具步已完成）",
          meta: {
            execute_step: index + 1,
            execute_step_total: total,
            round,
            phase: "step_done_single_tool",
            allowed_tools: allowedToolNames
          }
        });
        break;
      }
    }

    return toolOutputs.length > 0 ?
        `${parsed.instruction}\n${toolOutputs.join("\n")}`
      : parsed.instruction;
  }

  private async generateFinalSummary(task: string): Promise<string> {
    const summary = this.trace
      .summarizeSteps()
      .slice(-30)
      .map((x) => `- [${x.type}] ${x.text}`)
      .join("\n");
    const messages: Msg[] = [
      {
        role: "system",
        content:
          "你是任务总结器。仅基于给定执行摘要做简短中文总结，不调用工具，不编造未发生的动作。"
      },
      {
        role: "user",
        content: `总任务：${task}\n\n执行摘要：\n${summary || "- 无"}\n\n请输出：完成度 + 关键动作。`
      }
    ];
    const completion = await this.chat(messages, "final_summary", false);
    return completion.choices[0]?.message?.content?.trim() ?? "";
  }

  private async chat(
    messages: Msg[],
    stage: string,
    withTools: boolean,
    allowedToolNames?: string[]
  ): Promise<OpenAI.Chat.Completions.ChatCompletion> {
    const trimmed = this.trimMessages(messages);
    let toolDefs: Tool[] = [...this.tools.values()];
    if (withTools && allowedToolNames !== undefined) {
      if (allowedToolNames.length === 0) {
        toolDefs = [];
      } else {
        const allow = new Set(allowedToolNames);
        toolDefs = toolDefs.filter((t) => allow.has(t.name));
      }
    }
    const req: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming = {
      model: this.model.modelId,
      temperature: this.model.temperature,
      max_tokens: this.model.maxTokens,
      messages: trimmed,
      ...(withTools && toolDefs.length > 0 ? { tools: toOpenAITools(toolDefs) } : {})
    };
    this.modelIoLogs.push({ ts: new Date().toISOString(), stage: `${stage}_req`, data: req });
    const completion = await this.model.client.chat.completions.create(req);
    this.modelIoLogs.push({ ts: new Date().toISOString(), stage: `${stage}_res`, data: completion });
    return completion;
  }

  private trimMessages(messages: Msg[]): Msg[] {
    const maxTotal = this.contextWindow;
    if (messages.length <= maxTotal) return messages;

    const systemMsgs = messages.filter((m) => m.role === "system");
    const otherMsgs = messages.filter((m) => m.role !== "system");
    const maxOther = Math.max(1, maxTotal - systemMsgs.length);

    const keptReversed: Msg[] = [];
    let keptCount = 0;
    let needPrevAssistantForTool = false;

    for (let i = otherMsgs.length - 1; i >= 0; i--) {
      const m = otherMsgs[i]!;
      keptReversed.push(m);
      keptCount++;

      if (m.role === "tool") {
        needPrevAssistantForTool = true;
      }

      if (needPrevAssistantForTool) {
        const raw = m as { role?: string; tool_calls?: unknown[] };
        const isAssistantWithToolCalls =
          raw.role === "assistant" && Array.isArray(raw.tool_calls) && raw.tool_calls.length > 0;
        if (isAssistantWithToolCalls) {
          needPrevAssistantForTool = false;
        }
      }

      if (keptCount >= maxOther && !needPrevAssistantForTool) {
        break;
      }
    }

    return [...systemMsgs, ...keptReversed.reverse()];
  }

  private truncate(output: string): string {
    const max = this.toolOutputMaxChars;
    if (output.length <= max) return output;
    const head = output.slice(0, Math.floor(max * 0.75));
    const tail = output.slice(-Math.floor(max * 0.15));
    return `${head}\n…[trimmed]…\n${tail}`;
  }

  private pushTrace(step: TraceStep): void {
    this.trace.add(step);
    if (!this.traceBatch) this.trace.printLastAdded();
  }

  private finish(answer: string): string {
    const traceFile = this.trace.flushToFile();
    const ioFile = this.flushModelIoLog();
    if (this.traceBatch) this.trace.print();
    else this.trace.printEndMarker();

    const usage = formatRunTokenUsagePlaintext(this.trace.summarizeTokenUsage());
    return `${answer}\n\n本次 token 消耗：\n${usage}\n\n(trace: ${traceFile})\n(model_io: ${ioFile})`;
  }

  private flushModelIoLog(): string {
    const runDir = path.resolve(process.cwd(), "runs");
    fs.mkdirSync(runDir, { recursive: true });
    const filePath = path.join(runDir, `${this.modelIoRunId}.model-io.json`);
    const lines = this.modelIoLogs.map((x) => JSON.stringify(x)).join("\n");
    fs.writeFileSync(filePath, lines ? `${lines}\n` : "", "utf8");
    return filePath;
  }
}
