/** 小车仿真：对外用相对方位角 + 距离；内部仍用网格做运动与碰撞 */

export enum Direction {
  UP = 0,
  RIGHT = 1,
  DOWN = 2,
  LEFT = 3
}

export const DIR_ZH = ["北", "东", "南", "西"] as const;

const DIR_DELTA: Record<Direction, [number, number]> = {
  [Direction.UP]: [-1, 0],
  [Direction.RIGHT]: [0, 1],
  [Direction.DOWN]: [1, 0],
  [Direction.LEFT]: [0, -1]
};

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomSample<T>(arr: T[], k: number): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = randomInt(0, i);
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, k);
}

function normalizeAngle(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

function directionToDeg(d: Direction): number {
  switch (d) {
    case Direction.UP:
      return 0;
    case Direction.RIGHT:
      return 90;
    case Direction.DOWN:
      return 180;
    case Direction.LEFT:
      return 270;
    default:
      return 0;
  }
}

function degToDirection(deg: number): Direction {
  const n = ((Math.round(deg / 90) * 90) % 360 + 360) % 360;
  switch (n) {
    case 0:
      return Direction.UP;
    case 90:
      return Direction.RIGHT;
    case 180:
      return Direction.DOWN;
    case 270:
      return Direction.LEFT;
    default:
      return Direction.UP;
  }
}

export type PolarReading = {
  bearing_deg: number;
  distance_m: number;
};

export type GridEnvOptions = {
  hints?: [string, string];
  size?: number;
  numObstacles?: number;
  maxSteps?: number;
};

export class GridCarEnv {
  readonly size: number;
  readonly numObstacles: number;
  readonly hints: readonly [string, string];
  readonly maxSteps: number;

  carPos: [number, number];
  carDir: Direction;
  pickupCell: [number, number];
  placeCell: [number, number];
  carrying: boolean;
  obstacles: Set<string>;
  steps: number;
  done: boolean;

  private photoFrameId = 0;
  private detectFrameId = 0;
  private goFrameId = 0;
  private arrivedAtNavTarget = false;
  /** 本段 detect 估计的目标格（内部），用于判断 go_to 是否到位 */
  private lastNavTarget: [number, number] | null = null;

  constructor(opts: GridEnvOptions = {}) {
    this.hints = [opts.hints?.[0]?.trim() ?? "", opts.hints?.[1]?.trim() ?? ""];
    this.size = opts.size ?? 6;
    this.numObstacles = opts.numObstacles ?? 3;
    this.maxSteps = opts.maxSteps ?? 80;
    this.carPos = [0, 0];
    this.carDir = Direction.DOWN;
    this.pickupCell = [0, 0];
    this.placeCell = [0, 0];
    this.carrying = false;
    this.obstacles = new Set();
    this.steps = 0;
    this.done = false;
    this.reset();
  }

  reset(): string {
    this.steps = 0;
    this.done = false;
    this.carrying = false;
    this.arrivedAtNavTarget = false;
    this.lastNavTarget = null;

    const allCells: [number, number][] = [];
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        allCells.push([r, c]);
      }
    }

    const positions = randomSample(allCells, 3 + this.numObstacles);
    this.carPos = positions[0]!;
    this.pickupCell = positions[1]!;
    this.placeCell = positions[2]!;
    this.obstacles = new Set(positions.slice(3).map((p) => `${p[0]},${p[1]}`));
    this.carDir = randomInt(0, 3) as Direction;
    this.photoFrameId = 0;
    this.detectFrameId = 0;
    this.goFrameId = 0;

    return this.takePhoto();
  }

  takePhoto(): string {
    this.photoFrameId++;
    return (
      `📷 车载摄像头已拍照（帧 #${this.photoFrameId}）。` +
      `画面已缓存；请紧接着 detect_objects（返回相对车体的**方位角 + 距离**）。`
    );
  }

  private cellDistanceM(a: [number, number], b: [number, number]): number {
    const dr = b[0] - a[0];
    const dc = b[1] - a[1];
    return Math.sqrt(dr * dr + dc * dc);
  }

  /** 从车体坐标系：0°=正前方，顺时针为正，得到目标相对读数 */
  private polarFromCells(from: [number, number], to: [number, number], heading: Direction): PolarReading {
    const dr = to[0] - from[0];
    const dc = to[1] - from[1];
    const distance_m = Math.sqrt(dr * dr + dc * dc);
    const absoluteDeg = (Math.atan2(dc, -dr) * 180) / Math.PI;
    const bearing_deg = normalizeAngle(absoluteDeg - directionToDeg(heading));
    return {
      bearing_deg: Math.round(bearing_deg * 10) / 10,
      distance_m: Math.round(distance_m * 10) / 10
    };
  }

  private noisyTargetCell(truePos: [number, number]): [number, number] {
    for (let attempt = 0; attempt < 10; attempt++) {
      const jr = Math.max(0, Math.min(this.size - 1, truePos[0] + randomInt(-1, 1)));
      const jc = Math.max(0, Math.min(this.size - 1, truePos[1] + randomInt(-1, 1)));
      const key = `${jr},${jc}`;
      if (!this.obstacles.has(key) || (jr === truePos[0] && jc === truePos[1])) {
        return [jr, jc];
      }
    }
    return [truePos[0], truePos[1]];
  }

  private noisyPolar(truePos: [number, number]): { cell: [number, number]; polar: PolarReading } {
    const cell = this.noisyTargetCell(truePos);
    const raw = this.polarFromCells(this.carPos, cell, this.carDir);
    const bearing_jitter = randomInt(-12, 12);
    const dist_jitter = randomInt(-10, 10) / 10;
    return {
      cell,
      polar: {
        bearing_deg: normalizeAngle(raw.bearing_deg + bearing_jitter),
        distance_m: Math.max(0.1, Math.round((raw.distance_m + dist_jitter) * 10) / 10)
      }
    };
  }

  detectObjects(): string {
    if (this.detectFrameId >= this.photoFrameId) {
      return (
        "❌ 尚无可用画面。请先 take_photo，再调用 detect_objects。\n" +
        "（每段新导航：拍照 → 识别 → go_to → pick_up 或 drop。）"
      );
    }

    this.detectFrameId = this.photoFrameId;
    this.arrivedAtNavTarget = false;

    const [h0, h1] = this.hints;
    const navigatingToPickup = !this.carrying;
    const targetIndex = navigatingToPickup ? 0 : 1;
    const targetHint = navigatingToPickup ? h0 : h1;
    const trueCell = navigatingToPickup ? this.pickupCell : this.placeCell;
    const { cell, polar } = this.noisyPolar(trueCell);
    this.lastNavTarget = cell;

    const otherHint = navigatingToPickup ? h1 : h0;
    const phaseNote =
      navigatingToPickup && otherHint ?
        `\n⚠️ 未携带：本帧仅识别第一段目标「${targetHint || "index0"}」。找「${otherHint}」须先 pick_up 再拍照识别。\n`
      : !navigatingToPickup && h0 ?
        `\n（已携带：本帧识别第二段放置目标。）\n`
      : "";

    const head =
      `【视觉识别 · 帧 #${this.photoFrameId}】相对**当前车头**的极坐标（非地图格子坐标）。\n` +
      `车头朝向：${DIR_ZH[this.carDir]}\n` +
      `目标 index=${targetIndex}${targetHint ? `「${targetHint}」` : ""}：` +
      `方位 bearing_deg=${polar.bearing_deg}°（0°=正前方，顺时针为正），距离 distance_m=${polar.distance_m} m（约 ${Math.round(polar.distance_m)} 格）\n` +
      `→ 请调用 go_to(bearing_deg=${polar.bearing_deg}, distance_m=${polar.distance_m})\n` +
      phaseNote +
      `到位后可 pick_up 或 drop。`;

    const machine = {
      sim: "onboard_camera_polar",
      photo_frame: this.photoFrameId,
      car_heading: DIR_ZH[this.carDir],
      navigation_target: {
        index: targetIndex,
        ...(targetHint ? { hint: targetHint } : {}),
        bearing_deg: polar.bearing_deg,
        distance_m: polar.distance_m
      },
      note: "bearing relative to current heading; 0=forward, clockwise positive"
    };
    return `${head}\n\n${JSON.stringify(machine, null, 2)}`;
  }

  goTo(bearingDeg: number, distanceM: number): string {
    if (this.done) return "任务已完成！";

    if (this.goFrameId >= this.detectFrameId) {
      return (
        "❌ 须先完成本段：take_photo → detect_objects → go_to。\n" +
        `   photo #${this.photoFrameId}，detect #${this.detectFrameId}，nav #${this.goFrameId}。`
      );
    }

    if (this.lastNavTarget === null) {
      return "❌ 尚无本段识别结果，请先 detect_objects。";
    }

    const bearing = normalizeAngle(Number(bearingDeg));
    const distance = Math.max(0, Number(distanceM));
    const moveDeg = directionToDeg(this.carDir) + bearing;
    const moveDir = degToDirection(moveDeg);

    this.arrivedAtNavTarget = false;
    const turnNote =
      this.carDir === moveDir ?
        `保持朝${DIR_ZH[moveDir]}`
      : `转向 ${bearing}°（现朝${DIR_ZH[moveDir]}）`;

    this.carDir = moveDir;
    const steps = Math.round(distance);
    const [dr, dc] = DIR_DELTA[moveDir];
    let moved = 0;
    const pathNotes: string[] = [];

    for (let i = 0; i < steps; i++) {
      if (this.done) break;
      const limit = this.consumeStep();
      if (limit) {
        pathNotes.push(limit);
        break;
      }
      const nxt: [number, number] = [this.carPos[0] + dr, this.carPos[1] + dc];
      if (!this.isValid(nxt)) {
        pathNotes.push(`⚠️ 前进受阻于障碍，停在 (${this.carPos[0]},${this.carPos[1]})。`);
        break;
      }
      this.carPos = nxt;
      moved++;
      pathNotes.push(`前进 1m → 累计 ${moved}m`);
    }

    this.goFrameId = this.detectFrameId;
    const remain = this.cellDistanceM(this.carPos, this.lastNavTarget);
    this.arrivedAtNavTarget = remain <= 1.25 || moved >= steps;

    const status =
      this.arrivedAtNavTarget ?
        `✅ 已按 bearing=${bearing}°、distance=${distance}m 完成本段移动（实际 ${moved}m），距目标约 ${remain.toFixed(1)}m。可 ${this.carrying ? "drop" : "pick_up"}。`
      : `⚠️ 已移动 ${moved}m，距识别目标仍约 ${remain.toFixed(1)}m，可再微调 go_to 或重新 detect。`;

    return `${turnNote}，${status}\n${pathNotes.length ? pathNotes.map((n) => `  · ${n}`).join("\n") : ""}`;
  }

  pickUp(): string {
    if (this.done) return "任务已完成！";
    const limit = this.consumeStep();
    if (limit) return limit;
    if (this.carrying) return "⚠️ 已在携带物体。";
    if (!this.arrivedAtNavTarget) {
      return "❌ 请先 go_to 按识别方位/距离到位，再 pick_up。";
    }
    this.carrying = true;
    this.arrivedAtNavTarget = false;
    return `🎯 已拾取 index=0${this.hints[0] ? `（${this.hints[0]}）` : ""}。`;
  }

  drop(): string {
    if (this.done) return "任务已完成！";
    const limit = this.consumeStep();
    if (limit) return limit;
    if (!this.carrying) return "❌ 当前未携带，无法放下。";
    if (!this.arrivedAtNavTarget) {
      return "❌ 请先 go_to 按识别方位/距离到位，再 drop。";
    }
    this.carrying = false;
    this.arrivedAtNavTarget = false;
    this.done = true;
    return `🎉 已放下 index=1${this.hints[1] ? `（${this.hints[1]}）` : ""}，任务完成。`;
  }

  getStatusText(): string {
    if (this.done) return "任务已完成！";
    const phase = this.carrying ? "去放置" : "去拾取";
    const nav = this.arrivedAtNavTarget ? "已到位" : "未到位";
    return `小车 朝${DIR_ZH[this.carDir]} | ${phase} | ${nav} | 步${this.steps}/${this.maxSteps}`;
  }

  private consumeStep(): string | null {
    this.steps++;
    if (this.steps >= this.maxSteps) {
      this.done = true;
      return "⚠️ 达到最大步数，任务失败！";
    }
    return null;
  }

  private isValid(pos: [number, number]): boolean {
    const [r, c] = pos;
    return r >= 0 && r < this.size && c >= 0 && c < this.size && !this.obstacles.has(`${r},${c}`);
  }
}
