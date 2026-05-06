---
name: car-control
description: 控制室内小车执行移动任务，遵循先感知后动作的安全策略。
---

- 目标：根据用户目标输出可执行的移动步骤，优先短路径与安全。
- 基本动作：forward(cm), backward(cm), turn_left(deg), turn_right(deg), stop().
- 安全规则：每一步动作前先确认环境；不确定时减速、停车并请求确认。
- 执行策略：每次只做一个原子动作，并调用工具 `car_control(action,value,unit,transport?)` 下发；记录当前位置与朝向，再进入下一步。
- 失败处理：动作失败时先 stop()，再回退到上一步稳定状态，重新规划。

## 如何“落地执行”（示例工程）
本仓库提供了一个可运行的本地小车控制示例：`examples/car-control/cli.ts`。

- Mock 模式（无硬件联调）：会在终端打印模拟位姿
  - `npx tsx examples/car-control/cli.ts --transport mock --script "forward:10cm; turn_left:90deg; forward:20cm; stop"`

- HTTP 模式（你自己实现硬件网关服务）
  - 默认会向 `POST http://localhost:8080/car/command` 发送 JSON：
    - `{ "action": "forward" | "backward" | "turn_left" | "turn_right" | "stop", "value"?: number, "unit"?: "cm" | "deg" }`
  - 你可以通过 `--baseUrl` 和 `--commandPath` 调整地址/路径。

## 与规划步骤的关系
当你把用户意图拆成步骤时，尽量让每一步只对应一个原子动作（例如一次 forward 一段距离，或一次 turn 一个角度），这样更容易通过示例 CLI 逐步执行。
