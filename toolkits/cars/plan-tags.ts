/**
 * 小车 / 机械臂 toolkit 的规划标签 → 工具映射与无 [TAG] 时的启发式（仅 cars 域，不在 src/plan-routing）。
 */

export const CAR_PLAN_TAG_TOOL_GROUPS: Record<string, readonly string[]> = {
  CAPTURE: ["camera_capture"],
  VISION: ["vision_detect", "skill_call"],
  DRIVE: ["car_control"],
  GRASP: ["arm_grasp"],
  RELEASE: ["arm_release"]
};

/** 无 [TAG] 时按中文/英文关键词猜候选工具 */
export function carPlanToolHeuristic(instruction: string): string[] | undefined {
  const s = instruction.toLowerCase();
  if (/拍照|拍摄|camera/.test(s)) return ["camera_capture"];
  if (/识别|定位|detect|vision/.test(s)) return ["vision_detect", "skill_call"];
  if (/抓|捡起|grasp/.test(s)) return ["arm_grasp"];
  if (/放入|释放|release/.test(s)) return ["arm_release"];
  if (/移动|前进|后退|转|car|底盘/.test(s)) return ["car_control"];
  return undefined;
}
