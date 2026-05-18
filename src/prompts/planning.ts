/** 规划器提示：短版原则（常驻 system）+ 可选结构化附录（Facts survey + Plan） */

export const PLANNER_SYSTEM_PRINCIPLES =
  "你是任务规划器：先区分已知事实、待查事实与可推导结论，再制定剩余步骤的高层计划。\n" +
  "不调用工具；不做无根据假设；不编造用户未提到的目标。\n" +
  "尽量让每个规划步对应 toolkit 中一种可执行能力，一步一事。";

/** 完整结构化工作流（按需追加到 planner system） */
export const PLANNER_STRUCTURED_APPENDIX = `## 输出结构（首轮规划必须遵守）

先写事实梳理，再写计划；计划末尾必须是可执行的编号步骤。

### 1. Facts survey

#### 1.1. Facts given in the task
列出任务里直接给出的、对解题有帮助的事实（可能没有）。

#### 1.2. Facts to look up
列出需要查找的事实，并说明来源；任务里若已有来源请一并列出。

#### 1.3. Facts to derive
列出需通过推理、计算或仿真从上述事实得到的内容；每项附简要推理。

除上述三个标题外不要增加其他章节。

### 2. Plan

根据上文事实，为任务制定分步的高层计划。
计划应基于可用工具与能力，按步骤执行即可完成任务。
不要跳步，不要添加多余步骤；只写高层计划，不要写具体 tool call 或函数名。
写完编号步骤后，单独一行输出：<end_plan>

### 可执行步骤格式（写在「2. Plan」末尾、<end_plan> 之前）

- 若本运行要求 toolkit，**第一行**写：\`toolkit: <名称>\`
- 随后每行一步：\`1. …\` \`2. …\`，一步一事；条文来自用户任务，勿编造未提及的目标。
- 若任务含搬运到第二地点，第二段感知须在拾取之后。
- 以上步骤写完后，单独一行输出：\`<end_plan>\``;

export type PlannerPromptOptions = {
  isFirstStep: boolean;
  stepNumber: number;
  activeToolkit?: string;
  structuredPlanning: boolean;
  extra?: string;
};

export function buildPlannerSystemPrompt(opts: PlannerPromptOptions): string {
  const parts: string[] = [PLANNER_SYSTEM_PRINCIPLES];

  if (opts.isFirstStep) {
    parts.push("针对完整任务做首轮拆解。");
    if (opts.structuredPlanning) {
      parts.push(PLANNER_STRUCTURED_APPENDIX);
    } else {
      parts.push("用简短中文列出剩余步骤（编号列表即可）。");
    }
  } else {
    parts.push(
      `当前即将执行第 ${opts.stepNumber} 步，请根据已有对话更新**剩余**计划，勿重复已完成部分。`,
      "更新时可用简短编号列表；无需重复完整 Facts survey。"
    );
  }

  if (opts.activeToolkit) {
    parts.push(`第一行须为 toolkit: ${opts.activeToolkit}（写在可执行步骤块中）。`);
  }

  if (opts.extra?.trim()) {
    parts.push(opts.extra.trim());
  }

  return parts.join("\n");
}

/**
 * 从结构化规划输出中提取 toolkit 行与编号步骤，供 plan-routing 解析。
 */
export function extractExecutablePlan(raw: string): string {
  const lines = raw.split("\n");
  const trimmed = lines.map((l) => l.trim());

  let scanFrom = 0;
  const planHeadingIdx = trimmed.findIndex((l) => /^#*\s*2\.?\s*plan\s*$/i.test(l) || l === "2. Plan");
  if (planHeadingIdx >= 0) {
    scanFrom = planHeadingIdx + 1;
  }

  const toolkitLine = trimmed.find((l) => /^toolkit:\s*\S+/i.test(l));
  const numbered = trimmed
    .slice(scanFrom)
    .filter((l) => l.length > 0 && /^\d+\.\s*.+/.test(l) && !/^<end_plan>/i.test(l));

  if (toolkitLine && numbered.length > 0) {
    return [toolkitLine, ...numbered].join("\n");
  }
  if (numbered.length > 0) {
    return numbered.join("\n");
  }

  const fallbackNumbered = trimmed.filter((l) => /^\d+\.\s*.+/.test(l));
  if (toolkitLine && fallbackNumbered.length > 0) {
    return [toolkitLine, ...fallbackNumbered].join("\n");
  }
  if (fallbackNumbered.length > 0) {
    return fallbackNumbered.join("\n");
  }

  return raw.trim();
}
