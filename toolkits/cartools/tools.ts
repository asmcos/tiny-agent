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
          "识别导航目标：返回相对车头的 bearing_deg（方位角，0°=正前，顺时针为正）与 distance_m（距离，米）。须先 take_photo。",
        inputs: {},
        outputType: "string"
      },
      async () => env.detectObjects()
    ),
    tool(
      {
        name: "go_to",
        description:
          "按极坐标移动：bearing_deg 相对当前车头，distance_m 前进距离（米，约等于格数）。须先 take_photo → detect_objects，参数与 detect 一致。",
        inputs: {
          bearing_deg: {
            type: "number",
            description: "相对方位角（度），0=正前方，顺时针为正，与 detect 的 bearing_deg 一致"
          },
          distance_m: {
            type: "number",
            description: "前进距离（米），与 detect 的 distance_m 一致"
          }
        },
        outputType: "string"
      },
      async (args) => env.goTo(Number(args.bearing_deg), Number(args.distance_m))
    ),
    tool(
      {
        name: "pick_up",
        description: "拾取；须本段已 go_to 到位（take_photo → detect_objects → go_to）。",
        inputs: {},
        outputType: "string"
      },
      async () => env.pickUp()
    ),
    tool(
      {
        name: "drop",
        description: "放下物体；须已携带且本段 go_to 已到位。",
        inputs: {},
        outputType: "string"
      },
      async () => env.drop()
    )
  ];
}
