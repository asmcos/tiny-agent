# toolkits/fridge

- **Skill**：`skills/` 下 Markdown。  
- **Tool**：`fridge-tools.ts` 的 `buildFridgeTools()`（当前为空数组；接入硬件后在此实现），由 **`toolkits/run.ts`** 在 `fridge` 子命令里注入。

```bash
npx tsx toolkits/run.ts fridge "将冷藏室设为 4 度"
```

`toolkits/run.ts` 会在启动前将 cwd 切到本目录，以便 `config.json` 里 `skill.rootDir: "skills"` 正确解析。
