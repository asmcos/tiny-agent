# toolkits

每个子目录是一套**领域能力包**：包含 **`skills/`**（Markdown）与 **`robot-tools.ts` / `fridge-tools.ts` 等**（经 `TinyAgent({ extraTools })` 注入）。**统一 CLI** 在 **`toolkits/run.ts`**（`cars` / `fridge` 子命令），子目录下**不放** `main.ts`。`run.ts` 会设置 `activeToolkit` 并传入 **`planTagToolGroups` / `planToolHeuristic`**（如 cars 使用 `toolkits/cars/plan-tags.ts`）；框架内 `src/plan-routing.ts` 仅负责解析与核心 TAG。

共享的 LLM 与运行时参数可用仓库根目录 `config.json`，或像 `fridge` 一样使用 toolkit 内 `config.json`（`toolkits/run.ts` 在启动 `fridge` 时 `chdir` 到该目录）。

| 子目录 | 说明 |
|--------|------|
| `cars/` | 小车 / 机械臂：`skills/` + `robot-tools.ts` |
| `fridge/` | 冰箱示例：`skills/` + 独立配置 |
