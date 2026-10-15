import type { RouteTarget } from "../agent/routing/route-task";

const LABELS: Record<Exclude<RouteTarget, "code">, string> = {
  desktop: "电脑控制",
  system: "系统维修",
  word: "Word",
  ppt: "PPT",
  robot: "小车"
};

export type ModuleAssignment = {
  target: Exclude<RouteTarget, "code">;
  task: string;
  report: string;
};

/** 接收已路由的任务。这些模块只确认分配，不执行设备或文档操作。 */
export function acceptAssignment(target: Exclude<RouteTarget, "code">, task: string): ModuleAssignment {
  return {
    target,
    task,
    report: `已分配给${LABELS[target]}。\n任务：${task}`
  };
}
