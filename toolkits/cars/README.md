# toolkits/cars

- **Skill**：`skills/` 下 Markdown。  
- **Tool**：`robot-tools.ts` 的 `buildRobotTools()`，由 **`toolkits/run.ts`** 注入 `TinyAgent({ extraTools })`，**不在** `src/tools.ts`。  
- **规划标签**：`plan-tags.ts` 提供 `CAR_PLAN_TAG_TOOL_GROUPS` 与 `carPlanToolHeuristic`，同上注入 `planTagToolGroups` / `planToolHeuristic`。

从仓库根运行：

```bash
npx tsx toolkits/run.ts cars "你的任务描述"
```

根目录 `config.json` 的 `skill.rootDir` 应设为 `toolkits/cars/skills`（默认已如此）。
