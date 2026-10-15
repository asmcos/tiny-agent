# tiny-agent

本地工作区代码 Agent。多轮对话里每一句都会带着前面的分配结果，调用 `route.assign`，分到编程、电脑控制、系统维修、Word、PPT 或小车。编程进入工具循环。其余模块只确认收到任务。

这一版是命令行，不是 Tauri 桌面。桌面界面、SQLite、多供应商专用适配器、向量索引和 MCP 还没做。

## 运行

```bash
npm install
cp config.example.json config.json   # 填写 apiKey
npm test
npm run dev -- --workspace .
npm run ui -- --workspace .
```

`npm run ui` 打开本地界面，地址是 http://127.0.0.1:4317 。布局接近 OpenWorker：左侧是六个模块，中间是多轮对话，需要执行命令时在输入框上方批准。界面是 tiny-agent 自己的页面，不是把 OpenWorker 嵌进来。

不带任务参数会进入交互模式，连续输入，`/exit` 退出。单次任务仍然可以：

```bash
npm run dev -- --workspace . --mode read_only "note.txt 里写了什么"
```

改文件：

```bash
npm run dev -- --workspace . --mode workspace_edit "把 README 的某一句改掉"
```

`terminal.run` 默认要在终端里输入 `y` 才会执行。`--mode controlled_auto --allow-command "npm test"` 只自动放行这条命令。

## 权限

| 模式 | 读 | 改工作区文件 | 终端 |
|------|----|--------------|------|
| `read_only` | 允许 | 拒绝 | 拒绝 |
| `workspace_edit` | 允许 | 允许 | 每次询问 |
| `controlled_auto` | 允许 | 允许 | 仅允许列表里的 argv |

路径必须落在 `--workspace` 之内。`node_modules`、`.git`、`.env` 默认不可访问。`file.edit` 覆盖前会把原文备份到系统临时目录。

## 内置工具

`workspace.list`、`file.read`、`file.search`、`file.write`、`file.edit`、`file.diff`、`terminal.run`、`process.list`、`git.status`、`git.diff`、`test.run`、`models.list`、`agent.status`。

`test.run` 和 `terminal.run` 都是进程权限，需要批准。问模型「跑一下测试」时，它应调用 `test.run`。

## 布局

| 路径 | 职责 |
|------|------|
| `src/agent/core` | 状态机、停止条件、主循环 |
| `src/agent/execution` | 审批判断 |
| `src/models` | 与供应商无关的消息类型；OpenAI 兼容适配器 |
| `src/tools` | 注册表和内置工具 |
| `src/workspace` | 工作区路径检查 |
