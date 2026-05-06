---
name: robot-a-to-b
description: 移动操作物体 A 到参考物体 B 旁边：分两阶段感知；B 的可导航位姿必须在抓取 A 之后、再次拍照后识别，禁止用抓取前旧图上的 B 做驶向 B 的导航。
---

## 目标

把**操作物体 A**（需被抓取并移动）移动到**参考物体 B**（目标位置参照物）**旁边**，再释放 A。

## 准确性约束（必须遵守）

1. **阶段一（找 A）**：拍工作区 → **只**精确定位 A（此步不要用 B 的位姿做驶向 B 的导航）。
2. **阶段二（靠近并抓 A）**：底盘靠近 A → 停车 → 机械臂抓取 A。
3. **阶段三（找 B，车体已动）**：抓取后**必须再拍照** → **只**识别 B 并得到位姿/方位+距离；车体已移动，**禁止**使用抓取前旧图上的 B 结果做导航。
4. **阶段四（就位并放）**：驶向 B 附近 → 停车 → 在 B 旁边释放 A。

## 工具顺序（与 `laundry-pick-place` 同构）

`camera_capture` → `vision_detect`(A) → `car_control` → `arm_grasp` → `camera_capture` → `vision_detect`(B) → `car_control` → `arm_release`

参数提示：`vision_detect.target_object` 用任务里对 A/B 的称呼；`arm_grasp.target_hint`、`arm_release.place_hint` 与之一致或可读短描述。
