/** 小车领域说明，供 examples/car 写入 Agent instructions / config prompts */

export function buildCarDomainInstructionsCompact(): string {
  return (
    `小车导航用**方位角+距离**（相对车头）：detect 返回 bearing_deg、distance_m；` +
    `go_to(bearing_deg, distance_m) 与 detect 一致。0°=正前，顺时针为正；1m≈1格。` +
    `流程：take_photo → detect_objects → go_to → pick_up/drop。未拾取只认 index0；拾取后再识别 index1。`
  );
}

export function buildCarDomainInstructions(): string {
  return `你是带**车载摄像头**的小车智能体：靠拍照 + 视觉识别获取**相对方位与距离**，再导航。

## 可用工具
- **take_photo**：拍照缓存画面。
- **detect_objects**：返回相对**当前车头**的 **bearing_deg**（°，0=正前，顺时针为正）与 **distance_m**（米）。
- **go_to(bearing_deg, distance_m)**：先转向再沿该方向前进给定距离；参数须与最近一次 detect 一致。
- **pick_up** / **drop**：本段 go_to 到位后调用。

## 仿真关键
- **不要用地图格子坐标**；只使用 detect 给出的 bearing_deg / distance_m。
- 未携带时识别 **index=0**；携带后才识别 **index=1**。
- 搬运任务：感知→移动→抓取→再感知→移动→放置；第二段感知须在 pick_up 之后。

## 导航硬规则
- 每段新目标：take_photo → detect_objects → go_to → pick_up 或 drop。
- 按规划【执行 k/n】逐步做，勿跨步。`;
}

export function buildToolkitPlannerHint(toolkit = "cars"): string {
  return (
    `本运行 toolkit: ${toolkit}。只根据**用户任务原文**拆编号步骤。\n\n` +
    `## 能力类型\n` +
    `- **感知**：拍照并识别目标（得到方位角+距离）\n` +
    `- **移动**：按识别结果 go_to\n` +
    `- **抓取** / **放置**\n\n` +
    `## 按任务决定拆几步\n` +
    `- 只取物：感知 → 移动 → 抓取（3～4 步）\n` +
    `- 搬运到另一处：感知 → 移动 → 抓取 → 感知 → 移动 → 放置（约 6 步）\n\n` +
    `## 与仿真一致\n` +
    `- 导航用语为**方位+距离**，不是格子坐标。\n` +
    `- 未拾取前只识别 index=0；拾取后才识别 index=1。\n\n` +
    `## 输出格式\n` +
    `- 第一行：toolkit: ${toolkit}\n` +
    `- 随后 \`1. …\` \`2. …\``
  );
}
