/** 规划步是否已在 compact 模式下完成（按步骤语义判断，非「任意一个工具即停」） */

export function isPlanStepToolComplete(calledTools: ReadonlySet<string>, instruction: string): boolean {
  const has = (name: string) => calledTools.has(name);
  const text = instruction.trim();

  if (/感知|识别|拍照|定位|观察/.test(text)) {
    return has("take_photo") && has("detect_objects");
  }
  if (/移动|前往|移到|开到|走到|驶向|导航到/.test(text)) {
    return has("go_to");
  }
  if (/抓取|拾取|拿起|取物|捡起/.test(text)) {
    return has("pick_up");
  }
  if (/放置|放下|放到|搁到/.test(text)) {
    return has("drop");
  }

  return calledTools.size >= 2;
}
