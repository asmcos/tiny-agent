import fs from "node:fs";
import path from "node:path";
import type { Tool } from "../../src/tools";

/**
 * 小车 / 相机 / 机械臂 mock 工具（与 `toolkits/cars/skills` 配套）。
 * 通过 `toolkits/run.ts`（`cars` 子命令）传入 `TinyAgent({ extraTools: buildRobotTools() })`。
 */
export function buildRobotTools(): Tool[] {
  let mockX = 0;
  let mockY = 0;
  let mockHeadingDeg = 0;

  const sim = {
    lastImagePath: null as string | null,
    holding: null as string | null
  };

  return [
    {
      name: "car_control",
      description:
        "室内小车底盘原子动作：前进/后退/左转/右转/停车；支持本地 mock 或向 HTTP 网关下发 JSON。",
      jsonSchema: {
        type: "object",
        properties: {
          transport: {
            type: "string",
            description: "传输方式：mock（本地模拟）或 http（POST 到网关）"
          },
          baseUrl: { type: "string", description: "HTTP 网关根地址，例如 http://localhost:8080" },
          commandPath: { type: "string", description: "POST 路径，默认 /car/command" },
          action: {
            type: "string",
            description: "动作：forward 前进 | backward 后退 | turn_left 左转 | turn_right 右转 | stop 停车"
          },
          value: { type: "number", description: "前进/后退时为厘米距离；左转/右转时为角度（与 unit 配合）" },
          unit: { type: "string", description: "单位：cm（厘米）或 deg（度）" }
        },
        required: ["action"]
      },
      async run(params) {
        const transport = String(params.transport ?? "mock").toLowerCase();
        const baseUrl = String(params.baseUrl ?? "http://localhost:8080");
        const commandPath = String(params.commandPath ?? "/car/command");
        const action = String(params.action ?? "");
        const rawValue = params.value;
        const rawUnit = params.unit ? String(params.unit) : undefined;

        const allowed: Record<string, true> = {
          forward: true,
          backward: true,
          turn_left: true,
          turn_right: true,
          stop: true
        };
        if (!allowed[action]) {
          return `CAR_ERR invalid action=${action}`;
        }

        const normalizeUnit = (a: string, u?: string): "cm" | "deg" => {
          if (u === "cm" || u === "deg") return u;
          if (a === "turn_left" || a === "turn_right") return "deg";
          return "cm";
        };

        const normalizeValue = (a: string, v: unknown): number => {
          if (a === "stop") return 0;
          const n = Number(v ?? 0);
          if (!Number.isFinite(n)) throw new Error(`Invalid value for action=${a}: ${String(v)}`);
          return n;
        };

        if (transport === "mock") {
          if (action === "stop") {
            return `MOCK_OK action=stop state={x=${mockX.toFixed(2)}cm y=${mockY.toFixed(2)}cm heading=${mockHeadingDeg.toFixed(
              1
            )}deg}`;
          }

          const value = normalizeValue(action, rawValue);
          const unit = normalizeUnit(action, rawUnit);

          if (unit === "cm") {
            const distCm = action === "backward" ? -value : value;
            const rad = (mockHeadingDeg * Math.PI) / 180;
            mockX += Math.cos(rad) * distCm;
            mockY += Math.sin(rad) * distCm;
          } else {
            const delta = action === "turn_right" ? -value : value;
            mockHeadingDeg = (mockHeadingDeg + delta) % 360;
            if (mockHeadingDeg < 0) mockHeadingDeg += 360;
          }

          return `MOCK_OK action=${action} value=${value}${unit} state={x=${mockX.toFixed(2)}cm y=${mockY.toFixed(
            2
          )}cm heading=${mockHeadingDeg.toFixed(1)}deg}`;
        }

        if (transport === "http") {
          const b = baseUrl.replace(/\/+$/g, "");
          const p = commandPath.startsWith("/") ? commandPath : `/${commandPath}`;
          const url = `${b}${p}`;

          const value = action === "stop" ? undefined : normalizeValue(action, rawValue);
          const unit = action === "stop" ? undefined : normalizeUnit(action, rawUnit);

          const payload: Record<string, unknown> = { action };
          if (value !== undefined) payload.value = value;
          if (unit !== undefined) payload.unit = unit;

          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 5000);
            try {
              const res = await fetch(url, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify(payload),
                signal: controller.signal
              });
              const text = await res.text();
              if (!res.ok) return `HTTP_ERR status=${res.status} body=${text}`;
              return `HTTP_OK action=${action} body=${(text || "").trim()}`;
            } finally {
              clearTimeout(timeout);
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            return `HTTP_ERR: ${msg}`;
          }
        }

        return `CAR_ERR unknown transport=${transport}`;
      }
    },
    {
      name: "camera_capture",
      description:
        "机载摄像头拍照：在 runs/photos 下写入占位图文件，返回图片路径与时间戳（mock）。",
      jsonSchema: {
        type: "object",
        properties: {
          scene_tag: { type: "string", description: "场景标签，用于文件名，例如 workarea、post_grasp" }
        }
      },
      async run(params) {
        const tag = String(params.scene_tag ?? "scene").replace(/[^a-zA-Z0-9_-]/g, "_");
        const dir = path.resolve(process.cwd(), "runs", "photos");
        fs.mkdirSync(dir, { recursive: true });
        const fp = path.join(dir, `capture_${tag}_${Date.now()}.jpg`);
        await fs.promises.writeFile(fp, `mock image ${new Date().toISOString()}`);
        sim.lastImagePath = fp;
        return JSON.stringify({
          ok: true,
          image_path: fp,
          timestamp: new Date().toISOString(),
          frame: "onboard_camera"
        });
      }
    },
    {
      name: "vision_detect",
      description:
        "在图像中检测目标物体，返回标签与车体坐标系下的位姿/方位提示（mock：确定性演示）。可传 image_path，或依赖最近一次 camera_capture 的图。",
      jsonSchema: {
        type: "object",
        properties: {
          image_path: { type: "string", description: "待检测图片路径；省略则使用最近一次拍照路径" },
          target_object: { type: "string", description: "主目标物体描述，例如 红色方块、黄色衣服" },
          also_find: { type: "string", description: "可选的第二个目标，例如 收纳筐" }
        },
        required: ["target_object"]
      },
      async run(params) {
        const target = String(params.target_object ?? "").trim();
        const also = params.also_find != null ? String(params.also_find).trim() : "";
        const ip = String(params.image_path ?? "").trim() || sim.lastImagePath;
        if (!ip) {
          return JSON.stringify({ ok: false, error: "missing image_path; call camera_capture first" });
        }

        function hashStr(s: string): number {
          let h = 0;
          for (let i = 0; i < s.length; i++) {
            h = ((h << 5) - h + s.charCodeAt(i)) | 0;
          }
          return h;
        }

        function makeDetection(label: string, seed: number): Record<string, unknown> {
          const h = hashStr(label) + seed;
          const azimuthDeg = ((h % 61) - 30);
          const elevationDeg = ((h >> 4) % 11) - 6;
          const rangeM = 0.5 + ((h >> 8) & 0xff) / 255 * 2.0;
          const rad = (azimuthDeg * Math.PI) / 180;
          const xM = Math.cos(rad) * rangeM;
          const yM = Math.sin(rad) * rangeM;
          const confidence = 0.78 + ((h >> 16) & 0x3f) / 64 * 0.18;
          const objectId = label
            .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, "_")
            .replace(/^_+|_+$/g, "")
            .toLowerCase();
          const uvHash = (h ^ seed) >>> 0;
          return {
            object_id: objectId || `obj_${seed}`,
            label,
            confidence: Math.round(confidence * 100) / 100,
            frame: "onboard_camera",
            image_uv: { u: 200 + (uvHash % 600), v: 150 + ((uvHash >> 12) % 400) },
            bearing: { azimuth_deg: azimuthDeg, elevation_deg: elevationDeg },
            range_m: Math.round(rangeM * 100) / 100,
            pose_vehicle: { x_m: Math.round(xM * 100) / 100, y_m: Math.round(yM * 100) / 100, theta_deg: 0 },
            quality: "mono_estimate"
          };
        }

        const detections: Array<Record<string, unknown>> = [];
        detections.push(makeDetection(target, 0));
        if (also && also.length > 0) {
          detections.push(makeDetection(also, 1));
        }

        return JSON.stringify({
          ok: true,
          image_path: ip,
          query: target,
          detections
        });
      }
    },
    {
      name: "arm_grasp",
      description: "机械臂闭合夹爪抓取物体（mock：更新内部「持有物」状态）。",
      jsonSchema: {
        type: "object",
        properties: {
          target_hint: { type: "string", description: "抓取目标提示，与任务中物体称呼一致，例如 红色方块" }
        }
      },
      async run(params) {
        const hint = String(params.target_hint ?? "物体").trim();
        if (sim.holding) {
          return JSON.stringify({ ok: false, error: `already holding ${sim.holding}, release first` });
        }
        sim.holding = hint || "物体";
        return JSON.stringify({ ok: true, holding: sim.holding, detail: `grasped: ${sim.holding}` });
      }
    },
    {
      name: "arm_release",
      description: "机械臂张开夹爪释放已抓取物体到指定位置附近（mock：清空持有状态）。",
      jsonSchema: {
        type: "object",
        properties: {
          place_hint: { type: "string", description: "放置位置提示，例如 绿色柱子旁边、收纳筐" }
        }
      },
      async run(params) {
        const place = String(params.place_hint ?? "").trim();
        const prev = sim.holding;
        if (!prev) {
          return JSON.stringify({ ok: false, error: "nothing held" });
        }
        sim.holding = null;
        return JSON.stringify({ ok: true, released: prev, place_hint: place || null });
      }
    }
  ];
}
