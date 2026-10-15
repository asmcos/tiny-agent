import { acceptAssignment } from "../accept";

/** @deprecated 使用 acceptAssignment("robot", task) */
export function acceptRobotTask(task: string) {
  return acceptAssignment("robot", task);
}
