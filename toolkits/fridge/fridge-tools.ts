import type { Tool } from "../../src/tools";

/** 冰箱领域工具；接入硬件后在此实现并导出，供 `toolkits/run.ts` 注入。 */
export function buildFridgeTools(): Tool[] {
  return [];
}
