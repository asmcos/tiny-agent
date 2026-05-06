# tiny-agent

一个**轻量、省 token**的智能体小框架：支持「规划 → 按步执行 → 按需调工具」，默认不把整本说明塞进上下文；需要时再通过分层 Skill 与裁剪策略控制窗口大小。

在此基础上，**调用与上下文是可观察的**：trace 会记录规划、每步对话与工具入参/返回，便于理解「token 主要花在哪些轮次、哪些工具」上，而不是以「透明调试」为第一卖点。

---

## 目标

1. **轻量、省 token**：依赖面小、代码路径短；通过 **Skill 分层**（只注入摘要、全文按需 `skill_call`）、**消息裁剪**（`contextWindow`）、**工具输出截断**（`toolOutputMaxChars`）等，把送进模型的上下文压在可控范围内。
2. **Plan → Execute**：先用一轮**不带 tools** 的规划把任务拆成有序步骤，再对**每一步**单独开带工具的对话，避免「一大段 system + 全文 skill + 全量历史」长期堆在同一条请求里。
3. **技能分层（Skill）**：启动时只建索引与短摘要；相关 skill 仅摘要进 planner/executor；完整 `SKILL.md` 由模型在需要时拉取，减少固定前缀 token。
4. **工具化环境交互**：读/写文件、shell 等由框架提供；领域动作（如小车 `car_control`）由 `toolkits/*` 注入 `extraTools`，由模型按步选用，避免为每种能力单独写死长 prompt。
5. **多提供商**：`config.json` 在 **Ollama** 与 **DeepSeek**（OpenAI 兼容 Chat Completions）之间切换。
6. **token 与行为可理解**：trace 中可回看每轮 prompt 要点、工具调用与返回，用于核对是否真实调工具、以及上下文是否在预期内增长（辅助理解，非「重型可观测平台」）。

### 仓库布局

| 路径 | 角色 |
|------|------|
| `src/` | 框架：`TinyAgent`、`SkillRegistry`、内置 tools、provider、trace |
| `examples/` | 小示例（mock LLM、独立 `car-control` CLI 等） |
| `tests/` | 自动化 / 集成测试 |
| `toolkits/` | 领域工具包：各子目录自带 `skills/`（如 `cars`、`fridge`）与可选 `*-tools.ts` |

根目录 `config.json` 默认将 `skill.rootDir` 设为 `toolkits/cars/skills`，保证 `src/index.ts` 与测试开箱即用。其它应用可用 `TinyAgent({ configPath: "…" })` 或环境变量 `TINY_AGENT_CONFIG` 指向应用内配置（参见 `toolkits/run.ts` 中 `fridge` 分支）。

---

## 技术框架

### 运行时栈

| 层级 | 说明 |
|------|------|
| 语言 / 构建 | TypeScript，`tsx` 开发、`tsc` 构建 |
| LLM 调用 | `openai` 官方 SDK，`chat.completions.create`（非流式） |
| 配置 | 根目录 `config.json`：`activeProvider`、`providers.*`、`skill`、`runtime` 等 |

### 核心模块与职责

```
用户输入
   → TinyAgent.run()
        → SkillRegistry.pickRelevant()     // 按任务文本匹配相关 skill（摘要级）
        → runPlan()                        // 规划：无 tools，产出编号步骤
        → executeOneStep() × N             // 执行：带 tools，多轮直到本步结束或达上限
        → 最终总结（无 tools）
        → TraceStore                       // 写入 runs/<runId>.json（每行一条 JSON）并打印 TRACE
```

- **`src/agent.ts`**：`TinyAgent` — 规划、按步执行、消息裁剪（`trimMessages`，保证 `assistant.tool_calls` 与 `role: tool` 成对）、`reasoning_content` 等兼容字段回传。
- **`src/skills.ts`**：`SkillRegistry` — 扫描 `config.json` → `skill.rootDir`（如 `toolkits/cars/skills`），解析 frontmatter（`name` / `description`），生成摘要与关键词；`readSkillFull` 供 `skill_call` 读全文。
- **`src/tools.ts`**：框架内置通用工具 — `read_file`、`write_file`、`bash`、`skill_call`。小车 / 相机 / 机械臂 mock 在 **`toolkits/cars/robot-tools.ts`**，由 `TinyAgent({ extraTools: buildRobotTools() })` 注入（见 `toolkits/run.ts` 的 `cars` 分支）。
- **`src/provider.ts`**：根据 `activeProvider` 构造 `OpenAI` 客户端（Ollama / DeepSeek）；若设置 `TINY_AGENT_MOCK_LLM=1` 且 **`TINY_AGENT_MOCK_LLM_MODULE`** 指向导出 `createMockLlmFetch()` 的模块，则用该假 `fetch` 拦截 `chat/completions`，**不向远端消耗 token**（示例实现见 `examples/agent-mocks/`）。
- **`src/config.ts`**：加载并校验 `config.json`。
- **`src/trace.ts`**：将 plan / execute / tool 记录落盘并打印。

### Skill 分层（与代码的对应关系）

| 级别 | 内容 | 触发时机 |
|------|------|----------|
| L1 | 所有 skill 的摘要列表（内存索引） | `SkillRegistry` 构造时读盘 |
| L2 | 与当前任务相关的 skill：**摘要片段**注入 planner / executor 的 system 消息 | `pickRelevant` 命中后 |
| L3 | 某 skill 的 **完整 Markdown** | 模型调用 `skill_call({ name })` 时 |

支持的文件布局（在 `skill.rootDir` 指向的目录下，例如 `toolkits/cars/skills/`）：

- `*.md`（单文件 skill）
- `<skill-name>/SKILL.md`

### 工具一览

**框架（`src/tools.ts`）**

| 工具名 | 作用 |
|--------|------|
| `read_file` | 读取项目内文本文件 |
| `write_file` | 写入项目内文本文件 |
| `bash` | 在项目 cwd 下执行 shell 命令 |
| `skill_call` | 按名称加载某个 skill 的全文 |

**小车应用（`toolkits/cars/robot-tools.ts`，经 `extraTools` 注入）**

| 工具名 | 作用 |
|--------|------|
| `car_control` | 小车原子动作：`forward` / `backward` / `turn_left` / `turn_right` / `stop`；`transport` 为 `mock` 或 `http` |
| `camera_capture` | 摄像头拍照：在 `runs/photos/` 写入占位图，返回 `image_path`（mock） |
| `vision_detect` | 识别 + 定位：`detections[]` mock |
| `arm_grasp` / `arm_release` | 机械臂抓取 / 释放（mock） |

### 运行时参数（`config.json` → `runtime`）

- `planOnly`：只跑规划，不执行步骤  
- `maxStepRounds`：单步内最大对话轮数（与实现中的重试/工具轮次相关）  
- `contextWindow`：每次请求前保留的最大消息条数（裁剪时会保持 tool 链完整）  
- `toolOutputMaxChars`：工具返回过长时截断再写入消息  
- `maxPlanSteps`：最多执行规划中的前几步  

### 规划与执行对齐（`toolkit` + `[TAG]`）

规划阶段模型输出**固定格式**，执行阶段按步**收窄工具列表**，避免「计划很泛、执行时靠猜」：

1. **首行**单独写领域包：`toolkit: core` | `toolkit: cars` | `toolkit: fridge`（与 `toolkits/run.ts` 子命令一致时，由 `TinyAgent({ activeToolkit })` 约束必须与入口相同）。  
2. **每条步骤**一行：`N. [TAG] 一句中文说明`；`TAG`→工具表由 **`mergePlanTagToolGroups(…)`** 合并得到：框架只在 `src/plan-routing.ts` 提供 **核心** 标签（`READ` / `WRITE` / `SHELL` / `SKILL` / `ANALYZE`）；小车等域标签在 **`toolkits/cars/plan-tags.ts`**（如 `CAPTURE`→`camera_capture`），通过 `TinyAgent({ planTagToolGroups, planToolHeuristic })` 注入。一步只用一个主 `TAG`。  
3. **执行**：每步请求里会带 `[PLAN_TAG:XXX]`，且 OpenAI `tools` 只包含本步允许的工具名；trace 的 `execute.meta` 含 `plan_tag` 与 `allowed_tools`。  
4. **兼容**：若模型未写 `[TAG]`，会退回旧式「按中文关键词猜工具」；仍无匹配则用通用四件套。

可在 `config.json` → `prompts.planner` 追加你们自己的规划约束。

### TRACE 打印方式

- **默认**：每产生一条 trace（plan / tool / execute）就**立刻**在终端打印该条，最后再输出 `=== TRACE END ===`（便于「过程中」跟跑）。
- **恢复以前「结束时一次性打印全部」**：设置环境变量 `TINY_AGENT_TRACE_BATCH=1`。

---

## 如何验证是否达到「轻量 / 省 token」目标

「省 token」是**相对同一任务、同一模型**在「不做分层、不裁剪、不截断、一步里塞满工具与长上下文」时的对比；不是保证任意一次跑任务都便宜。建议用下面几条做**可重复**的验证：

1. **看账单 / 用量（真调用时）**  
   在控制台服务商后台看本次任务的 **prompt / completion 总 token**。若接口在响应里返回 `usage`（部分 OpenAI 兼容实现会带），trace 里对应 `plan` / `execute` 步骤会附带 `meta` 中的 `prompt_tokens`、`completion_tokens`、`total_tokens`（有则打印）。  
   Trace 与 `model-io` 日志只保存文本与结构化消息，**不含网络传输层字节数**；真实计费以接口 `usage` 与控制台账单为准。用日志文本自行估算 token 仅作粗算，不等同于账单。

2. **控制变量做 A/B**  
   - 同一句话，先 `runtime.planOnly: true` 只看规划成本；再关掉只跑前 `maxPlanSteps: 2` 看执行成本。  
   - 调小 `contextWindow`、`toolOutputMaxChars`、`skill.summaryHeadLines`，对比同一任务的总 token 是否下降。

3. **看 trace 里「谁在涨上下文」**  
   若同一步里反复 `read_file` / `bash` / 大段 `skill_call` 全文进对话，每轮都会把**历史消息 + 工具返回**再次送进模型，token 会近似 **线性 × 轮次** 增长。

4. **离线跑通链路（不花大模型 token）**  
   见下一节：用 `TINY_AGENT_MOCK_LLM=1` 验证 Plan → Execute → tool → trace 是否工作正常。

---

## 为何有时仍会消耗很多 token（例如「几十万」）

常见原因不是「框架故意费 token」，而是任务形态叠加：

| 因素 | 说明 |
|------|------|
| **规划步数多** | 模型拆出 8～10 步，每步至少 1～2 次 `chat.completions`（带 tools 时往往先出 `tool_calls` 再出一轮纯文本），总请求数 ≈ `1 + Σ(每步轮次) + 1`。 |
| **每步多轮工具** | 某一步里若模型连续 `bash` / `read_file` / `skill_call` 很多次，每轮都会把**整段对话历史**再送上去。 |
| **工具返回大** | 例如多次读 `package.json`、`ls -la` 大目录，即使用 `toolOutputMaxChars` 截断，截断后的文本仍会留在后续轮次的 `messages` 里。 |
| **模型与「思考」模式** | 若使用带 reasoning / thinking 的模型或参数，部分提供商会对「推理内容」单独计费或占用更多上下文，账单会明显高于「短答」场景。 |

框架提供的是**上限与开关**（裁剪、截断、分层 skill、限制步数）；**是否**在每一步狂调工具、是否把计划拆得很碎，仍主要由**模型行为与任务描述**决定，需要结合上表调参或收紧 prompt。

---

## 离线 Mock（不调用真实大模型）

设置 **`TINY_AGENT_MOCK_LLM=1`**（或 `true` / `yes`）且必须同时设置 **`TINY_AGENT_MOCK_LLM_MODULE`**（相对 `cwd` 或绝对路径）：该模块须导出 **`createMockLlmFetch(): typeof fetch`**，`createProviderRuntime` 会懒加载它并用于拦截 `POST .../chat/completions`，**不发起外网 LLM 请求**。

本仓库提供两个示例（均在 `examples/agent-mocks/`，不在 `src`）：

| 模块 | 用途 |
|------|------|
| **`genericMockLlmFetch.ts`** | 占位规划 + 按步骤关键词选假 `tool_calls`，供 smoke / 本地接线 |
| **`laundryCarMockFetch.ts`** | 捡衣 8 步 + 小车等演示剧本 |

```bash
npm run smoke:mock
```

等价于：

```bash
TINY_AGENT_MOCK_LLM=1 TINY_AGENT_MOCK_LLM_MODULE=examples/agent-mocks/genericMockLlmFetch.ts tsx tests/smoke.ts
```

用自然语言跑主程序（同样零远端 token，默认用示例 generic mock）：

```bash
npm run dev:mock -- "你的任务描述"
```

需要与文档中「捡衣 / 收纳」**8 步剧本**对齐的离线跑法（见 `docs/室内移动小车平台设计.md`）时，使用示例 mock：

```bash
npm run dev:mock:demo -- "捡起黄色衣服放入收纳筐"
```

捡衣 / 收纳类**离线 8 步剧本**由示例 mock `examples/agent-mocks/laundryCarMockFetch.ts` 驱动，与 `docs/室内移动小车平台设计.md` 对齐；真实 LLM 规划则按模型输出执行，流程约束可写在 toolkit 的 skill 中（例如 `toolkits/cars/skills/robot-a-to-b/SKILL.md`）。

---

## 快速开始

安装依赖：

```bash
npm install
```

配置 `config.json`（选择 `ollama` 或 `deepseek`，并填写对应 API / 地址）。使用 DeepSeek 时需在 `providers.deepseek` 中配置 `apiKey`。

根目录 **`npm run dev`** 只带框架通用工具（读写文件、bash、`skill_call`）；`config.json` 里仍会加载 `toolkits/cars/skills` 摘要，但若任务要调 **`car_control` / `camera_capture` 等**，请用小车入口（会注入 `extraTools`）：

```bash
npm run dev:cars -- "你的任务描述"
```

仅跑 CLI、仍用根 `config.json` 时，等价于：

```bash
npx tsx toolkits/run.ts cars "你的任务描述"
```

冰箱 toolkit（cwd 为 `toolkits/fridge`，技能在 `toolkits/fridge/skills`）：

```bash
npm run dev:fridge -- "将冷藏室设为 4 度"
```

构建与生产启动：

```bash
npm run build
npm start -- "你的任务描述"
```

冒烟测试：

```bash
npm run smoke
```

---

## 小车示例（可选）

仓库内另有独立示例目录 `examples/car-control/`（命令行 mock / HTTP），用于不经过 agent、单独验证动作序列；与 agent 内的 `car_control` 工具可对照使用。详见该目录下的 `README.md`。
