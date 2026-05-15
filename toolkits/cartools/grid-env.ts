/** 网格小车仿真：识别坐标带噪声，go_to 抵达后 pick_up/drop 即成功（不要求与隐藏真值格重合） */

export enum Direction {
  UP = 0,
  RIGHT = 1,
  DOWN = 2,
  LEFT = 3
}

export const DIR_ZH = ["北", "东", "南", "西"] as const;

const GRID_DIRS: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1]
];

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
  /** 仿真内部真值（不对 Agent 暴露精确拾放判定） */
  pickupCell: [number, number];
  placeCell: [number, number];
  carrying: boolean;
  obstacles: Set<string>;
  steps: number;
  done: boolean;

  private photoFrameId = 0;
  private detectFrameId = 0;
  private goFrameId = 0;
  /** 本段导航是否已 go_to 到「当前目标」的识别坐标 */
  private arrivedAtNavTarget = false;

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
    this.arrivedAtNavTarget = false;
    return (
      `📷 车载摄像头已拍照（帧 #${this.photoFrameId}，场地 ${this.size}×${this.size}，行列从 0 起）。` +
      `画面已缓存；请紧接着调用 detect_objects（识别结果为带噪声的估计坐标，非精确地图）。`
    );
  }

  /** 在真值附近随机偏移 0~1 格，模拟视觉估计 */
  private noisyReport(truePos: [number, number]): { row: number; col: number } {
    for (let attempt = 0; attempt < 10; attempt++) {
      const jr = Math.max(0, Math.min(this.size - 1, truePos[0] + randomInt(-1, 1)));
      const jc = Math.max(0, Math.min(this.size - 1, truePos[1] + randomInt(-1, 1)));
      const key = `${jr},${jc}`;
      if (!this.obstacles.has(key) || (jr === truePos[0] && jc === truePos[1])) {
        return { row: jr, col: jc };
      }
    }
    return { row: truePos[0], col: truePos[1] };
  }

  private turnPhrase(from: Direction, to: Direction): string {
    if (from === to) return `保持朝${DIR_ZH[from]}`;
    const cw = (to - from + 4) % 4;
    if (cw === 1) return `右转，朝${DIR_ZH[to]}`;
    if (cw === 2) return `掉头，现朝${DIR_ZH[to]}`;
    return `左转，朝${DIR_ZH[to]}`;
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

    const car = { row: this.carPos[0], col: this.carPos[1], heading: DIR_ZH[this.carDir] };
    const [h0, h1] = this.hints;
    const est0 = this.noisyReport(this.pickupCell);
    const est1 = this.noisyReport(this.placeCell);

    const navigatingToPickup = !this.carrying;
    const targetIndex = navigatingToPickup ? 0 : 1;
    const targetHint = navigatingToPickup ? h0 : h1;
    const targetPos = navigatingToPickup ? est0 : est1;

    const head =
      `【视觉识别 · 照片帧 #${this.photoFrameId}】以下为**估计坐标**（每次识别可有 ±1 格抖动，无精确地图）。\n` +
      `小车：(${car.row},${car.col}) 朝${car.heading}\n` +
      `本帧导航目标 index=${targetIndex}${targetHint ? `「${targetHint}」` : ""}：约 (${targetPos.row},${targetPos.col})\n` +
      `请用该坐标调用 go_to；抵达后 pick_up 或 drop 即可（仿真不校验隐藏真值格）。`;

    const machine = {
      sim: "onboard_camera_grid",
      photo_frame: this.photoFrameId,
      grid_size: this.size,
      car,
      navigation_target: {
        index: targetIndex,
        ...(targetHint ? { hint: targetHint } : {}),
        position: targetPos
      },
      note: "coordinates are noisy estimates; go_to then pick_up/drop succeeds on arrival"
    };
    return `${head}\n\n${JSON.stringify(machine, null, 2)}`;
  }

  goTo(targetX: number, targetY: number): string {
    if (this.done) return "任务已完成！";

    if (this.goFrameId >= this.detectFrameId) {
      return (
        "❌ 须先完成本段：take_photo → detect_objects → go_to。\n" +
        `   photo #${this.photoFrameId}，detect #${this.detectFrameId}，nav #${this.goFrameId}。`
      );
    }

    const target: [number, number] = [
      Math.max(0, Math.min(this.size - 1, Math.floor(targetX))),
      Math.max(0, Math.min(this.size - 1, Math.floor(targetY)))
    ];

    if (!this.isValid(target)) {
      return `❌ (${targetX},${targetY}) 越界或是障碍格。`;
    }

    this.arrivedAtNavTarget = false;

    if (this.posEq(this.carPos, target)) {
      this.goFrameId = this.detectFrameId;
      this.arrivedAtNavTarget = true;
      return `✅ 已在识别目标 (${target[0]},${target[1]})，可 pick_up 或 drop。`;
    }

    const path = this.bfs(this.carPos, target);
    if (path === null) {
      return `❌ 无法到达估计点 (${target[0]},${target[1]})。`;
    }

    path.shift();
    this.goFrameId = this.detectFrameId;
    const nav = this.navigateVerbose(path);
    this.arrivedAtNavTarget = true;
    return (
      `🎯 已按识别坐标抵达 (${this.carPos[0]},${this.carPos[1]})（目标约 (${target[0]},${target[1]})）。\n` +
      `可执行 ${this.carrying ? "drop" : "pick_up"}。\n\n${nav}`
    );
  }

  private navigateVerbose(path: [number, number][]): string {
    const events: string[] = [];
    for (const stepPos of path) {
      if (this.done) break;

      this.steps++;
      if (this.steps >= this.maxSteps) {
        this.done = true;
        events.push("⚠️ 达到最大步数，任务失败！");
        break;
      }

      const dr = stepPos[0] - this.carPos[0];
      const dc = stepPos[1] - this.carPos[1];
      let needDir: Direction;
      if (dr === 1) needDir = Direction.DOWN;
      else if (dr === -1) needDir = Direction.UP;
      else if (dc === 1) needDir = Direction.RIGHT;
      else needDir = Direction.LEFT;

      const turn = this.turnPhrase(this.carDir, needDir);
      this.carDir = needDir;
      this.carPos = stepPos;
      events.push(`${turn}；前进 → (${this.carPos[0]},${this.carPos[1]}) 朝${DIR_ZH[this.carDir]}`);
    }

    return `🚗 ${path.length} 步\n` + events.map((e) => `  · ${e}`).join("\n");
  }

  private bfs(start: [number, number], goal: [number, number]): [number, number][] | null {
    const queue: [number, number][][] = [[start]];
    const visited = new Set([`${start[0]},${start[1]}`]);

    while (queue.length > 0) {
      const path = queue.shift()!;
      const curr = path[path.length - 1]!;
      if (this.posEq(curr, goal)) return path;

      for (const [dr, dc] of GRID_DIRS) {
        const nxt: [number, number] = [curr[0] + dr, curr[1] + dc];
        const key = `${nxt[0]},${nxt[1]}`;
        if (this.isValid(nxt) && !visited.has(key)) {
          visited.add(key);
          queue.push([...path, nxt]);
        }
      }
    }
    return null;
  }

  pickUp(): string {
    if (this.done) return "任务已完成！";
    const limit = this.consumeStep();
    if (limit) return limit;
    if (this.carrying) return "⚠️ 已在携带物体。";
    if (!this.arrivedAtNavTarget) {
      return "❌ 请先按流程 go_to 抵达本段识别目标，再 pick_up。";
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
      return "❌ 请先 go_to 抵达放置点识别坐标，再 drop。";
    }
    this.carrying = false;
    this.arrivedAtNavTarget = false;
    this.done = true;
    return `🎉 已放下 index=1${this.hints[1] ? `（${this.hints[1]}）` : ""}，任务完成。`;
  }

  getStatusText(): string {
    if (this.done) return "任务已完成！";
    const phase = this.carrying ? "去放置" : "去拾取";
    const nav = this.arrivedAtNavTarget ? "已抵达本段目标" : "未抵达";
    return `小车(${this.carPos[0]},${this.carPos[1]}) | ${phase} | ${nav} | 步${this.steps}/${this.maxSteps}`;
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

  private posEq(a: [number, number], b: [number, number]): boolean {
    return a[0] === b[0] && a[1] === b[1];
  }
}
