import { tool, type Tool } from "../../src/base-tool";
import type { GridCarEnv } from "./grid-env";

/** 绑定仿真环境，返回小车工具集（仅 tools，不含 Agent）。 */
export function createCarTools(env: GridCarEnv): Tool[] {
  return [
    tool(
      {
        name: "take_photo",
        description: "车载摄像头拍照；必须先拍再 detect_objects。",
        inputs: {},
        outputType: "string"
      },
      async () => env.takePhoto()
    ),
    tool(
      {
        name: "detect_objects",
        description:
          "根据上一张 take_photo 的画面识别当前导航目标的估计坐标（每次只定位一个目标）；须先拍照。",
        inputs: {},
        outputType: "string"
      },
      async () => env.detectObjects()
    ),
    tool(
      {
        name: "go_to",
        description: "移动到格点 targetX=行、targetY=列；本轮须已已知距离，如果距离未知请先 take_photo → detect_objects。",
        inputs: {
          targetX: { type: "number", description: "行（0 起）" },
          targetY: { type: "number", description: "列（0 起）" }
        },
        outputType: "string"
      },
      async (args) => env.goTo(Number(args.targetX), Number(args.targetY))
    ),
    tool(
      {
        name: "pick_up",
        description: "拾取当前段目标 此段最好已经通过take_photo → detect_objects → go_to 到达目标点。",
        inputs: {},
        outputType: "string"
      },
      async () => env.pickUp()
    ),
    tool(
      {
        name: "drop",
        description: "放下物体（须已携带且本段 go_to 已完成）。",
        inputs: {},
        outputType: "string"
      },
      async () => env.drop()
    )
  ];
}
