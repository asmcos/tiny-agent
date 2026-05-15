# tiny-agent

轻量多步智能体：**自实现**规划与工具循环 

---

## 特性

- **两种运行形态**
  - **ReAct 模式**（默认）：`planningInterval` 可选；多轮 `model + tools`，`final_answer` 结束。
  - **规划步模式**（`planStepMode: true`）：首轮规划 → 按编号逐步执行；每步由模型**自行选工具**，框架不替模型锁工具（见 `examples/car.ts`）。
- **配置**：根目录 `config.json`（与 origin 同形）：`activeProvider`、`providers`、`runtime`、`prompts`。
- **模型**：DeepSeek / Ollama（OpenAI 兼容 Chat Completions）；支持 `reasoning_content` 回传（thinking 模型）。
- **可观察**：`TraceStore` 终端面板（`ui.format: "panels"`）；`runs/*.json` trace、`runs/*.model-io.json` 请求审计。
- **领域示例**：`toolkits/cartools` 网格小车仿真（拍照 → 识别 → 导航 → 拾放）。

---

## 快速开始

```bash
npm install
cp config.example.json config.json   # 填入 deepseek.apiKey 等
npm run build
npm run dev -- "用 multiply 算 17×23"
npm run car                          # 网格小车示例
```

小车带任务参数：

```bash
npx tsx examples/car.ts "把 index0 的物体搬到 index1"
```

环境变量：

| 变量 | 说明 |
|------|------|
| `TINY_AGENT_CONFIG` | 指定 `config.json` 路径 |
| `TINY_AGENT_TRACE_BATCH=1` | 跑完再一次性打印 trace |

---

## 仓库结构

| 路径 | 说明 |
|------|------|
| `src/agent.ts` | `ToolCallingAgent`：规划步 / ReAct 主循环 |
| `src/plan-routing.ts` | 解析规划文档（`toolkit:`、编号行） |
| `src/plan-step-scope.ts` | 规划步 user 文案（`buildPlanStepUserContent`） |
| `src/model.ts` | `OpenAIServerModel` |
| `src/config.ts` | 加载 `config.json` |
| `src/trace.ts` / `src/ui.ts` | Trace 落盘与终端面板 |
| `examples/basic.ts` | 最小算术工具示例 |
| `examples/car.ts` | 小车应用（组装 cartools + planStepMode） |
| `toolkits/cartools/` | 仿真环境、工具、`prompts` |

---

## 配置说明（`config.example.json`）

```json
{
  "activeProvider": "deepseek",
  "providers": { "ollama": { ... }, "deepseek": { ... } },
  "runtime": {
    "planOnly": false,
    "maxStepRounds": 20,
    "contextWindow": 24,
    "toolOutputMaxChars": 4000,
    "maxPlanSteps": 24,
    "planningInterval": 0
  },
  "prompts": { "planner": "", "executor": "" }
}
```

| 字段 | 含义 |
|------|------|
| `runtime.maxStepRounds` | 规划步模式下，**每个规划步**内最多 LLM 轮数 |
| `runtime.maxPlanSteps` | 最多执行几条规划步 |
| `runtime.planningInterval` | ReAct 模式下中途 replan 间隔；`0` 表示仅首轮规划 |
| `runtime.planOnly` | 只出规划、不执行 |

`config.json` 已在 `.gitignore`，勿提交 API Key。

---

## 作为库使用

```typescript
import { ToolCallingAgent, tool, OpenAIServerModel } from "tiny-agent";

const myTool = tool(
  {
    name: "echo",
    description: "Echo text",
    inputs: { text: { type: "string", description: "Input" } },
    outputType: "string"
  },
  async ({ text }) => String(text)
);

const agent = new ToolCallingAgent({
  tools: [myTool],
  instructions: "Use tools when helpful."
});

await agent.run("echo hello");
```

### 规划步模式（小车同款）

```typescript
new ToolCallingAgent({
  tools: createCarTools(env),
  planStepMode: true,
  restrictToolsPerPlanStep: false, // 不限制每步 API 工具列表
  activeToolkit: "cars",
  config: {
    prompts: {
      planner: buildToolkitPlannerHint("cars"),
      executor: buildCarDomainInstructions()
    }
  }
});
```

规划器提示（`toolkits/cartools/prompts.ts`）建议：**每一步对应一类能力**（感知 / 移动 / 抓取 / 放置），一步一事；执行阶段再选 `take_photo`、`go_to` 等，不在规划里写「必须调用 xxx」。

可选严格模式：`restrictToolsPerPlanStep: true` + `planTagToolGroups`（仅当规划行带 `[TAG]` 时限制工具）。

---

## 小车示例（`examples/car.ts`）

流程：

1. 用户输入任务（交互或 argv）。
2. 规划 LLM 输出 `toolkit: cars` + 编号步骤（步数随任务变化）。
3. 对每一步下发 `【执行 k/n】…`，模型调用 `take_photo` / `detect_objects` / `go_to` / `pick_up` / `drop`。
4. 仿真规则见 `toolkits/cartools/grid-env.ts`（识别坐标带噪声；`go_to` 完成后拾放即成功）。

---

## 与 tiny-agent-origin 的关系

| 项 | tiny-agent | origin |
|----|------------|--------|
| 核心循环 | 自实现 `ToolCallingAgent` | `TinyAgent` |
| smolagents.js | **不依赖** | 不依赖 |
| 配置 / trace UI | 对齐 | 同源思路 |
| Skills / 内置文件工具 | 未纳入本仓库 | 有 |

---

## 开发

```bash
npm run build    # tsc → dist/
npm run dev      # tsx examples/basic.ts
npm run car      # tsx examples/car.ts
```

---

## License

MIT
