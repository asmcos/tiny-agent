/**
 * Offline mock: 8-step "move object A beside object B" (red block → green pillar demo).
 * Use: TINY_AGENT_MOCK_LLM=1 TINY_AGENT_MOCK_LLM_MODULE=examples/agent-mocks/objectAToBMockFetch.ts
 */

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

type ChatMessage = Record<string, unknown>;

const AB_CONTEXT_RE = /红色方块|绿色柱子|方块.*柱子|移动到.*旁边|物体A|物体B|robot-a-to-b/i;

const PLAN_8 =
  "toolkit: cars\n" +
  "1. [CAPTURE] 用摄像头拍摄工作区，获取当前画面（用于找红色方块）。\n" +
  "2. [VISION] 仅识别红色方块，返回位姿/方位+距离（不在此步对绿色柱子做可导航的精确定位）。\n" +
  "3. [DRIVE] 移动底盘靠近红色方块。\n" +
  "4. [GRASP] 机械臂抓取红色方块。\n" +
  "5. [CAPTURE] 抓取完成后再次拍照，更新场景（车体已移动，旧图上的绿色柱子位置不可再用于导航）。\n" +
  "6. [VISION] 识别绿色柱子并返回位姿/方位+距离，供底盘驶向柱子使用。\n" +
  "7. [DRIVE] 移动底盘至绿色柱子附近。\n" +
  "8. [RELEASE] 机械臂在绿色柱子旁边释放红色方块。\n";

export function createMockLlmFetch(): typeof fetch {
  let seq = 0;

  return async (url: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const u = typeof url === "string" ? url : url.toString();
    if (!u.includes("chat/completions")) {
      return new Response(`mock: unsupported url ${u}`, { status: 404 });
    }

    let rawBody = "";
    const b = init?.body;
    if (typeof b === "string") {
      rawBody = b;
    } else if (b != null) {
      rawBody = String(b);
    }

    let body: Record<string, unknown> = {};
    try {
      body = rawBody ? (JSON.parse(rawBody) as Record<string, unknown>) : {};
    } catch {
      return jsonResponse({ error: { message: "mock: invalid JSON body" } });
    }

    const messages = (body.messages as ChatMessage[]) ?? [];
    const tools = body.tools as Array<Record<string, unknown>> | undefined;
    const hasTools = Array.isArray(tools) && tools.length > 0;
    const joined = JSON.stringify(messages);
    const last = messages[messages.length - 1];
    const lastRole = typeof last?.role === "string" ? last.role : "";
    const lastContent = typeof last?.content === "string" ? last.content : "";

    seq += 1;

    const completionShell = (message: Record<string, unknown>, finishReason: string): Record<string, unknown> => ({
      id: `chatcmpl-mock-ab-${seq}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "tiny-agent-object-a-b-mock",
      choices: [{ index: 0, message, finish_reason: finishReason }]
    });

    const abContext = AB_CONTEXT_RE.test(joined);

    if (!hasTools) {
      if (joined.includes("你是任务规划器")) {
        const planBody = abContext
          ? PLAN_8
          : "toolkit: core\n" +
            "1. [READ] 读取 package.json。\n" +
            "2. [ANALYZE] 验证环境。\n" +
            "3. [ANALYZE] 结束。\n";
        return jsonResponse(
          completionShell(
            {
              role: "assistant",
              content: planBody
            },
            "stop"
          )
        );
      }
      return jsonResponse(
        completionShell(
          { role: "assistant", content: "【mock-llm】本阶段无工具调用，已结束。" },
          "stop"
        )
      );
    }

    if (lastRole === "tool") {
      return jsonResponse(
        completionShell(
          { role: "assistant", content: "【mock-llm】本步工具已返回，结束本步。" },
          "stop"
        )
      );
    }

    const toolNames = (tools ?? [])
      .map((t) => (t as { function?: { name?: string } }).function?.name)
      .filter((n): n is string => Boolean(n));

    let name = toolNames.includes("read_file") ? "read_file" : toolNames[0] ?? "read_file";
    let args: Record<string, unknown> = {};
    let picked = false;

    if (lastRole === "user" && lastContent.includes("[步骤") && abContext) {
      const stepTag = lastContent.match(/\[步骤\s*(\d+)\s*\/\s*(\d+)\]/);
      const stepNum = stepTag ? parseInt(stepTag[1], 10) : 0;

      if (stepNum === 1 && toolNames.includes("camera_capture")) {
        name = "camera_capture";
        args = { scene_tag: "workarea" };
        picked = true;
      } else if (stepNum === 2 && toolNames.includes("vision_detect")) {
        name = "vision_detect";
        args = { target_object: "红色方块" };
        picked = true;
      } else if (stepNum === 3 && toolNames.includes("car_control")) {
        name = "car_control";
        args = { action: "forward", value: 30, unit: "cm", transport: "mock" };
        picked = true;
      } else if (stepNum === 4 && toolNames.includes("arm_grasp")) {
        name = "arm_grasp";
        args = { target_hint: "红色方块" };
        picked = true;
      } else if (stepNum === 5 && toolNames.includes("camera_capture")) {
        name = "camera_capture";
        args = { scene_tag: "post_grasp" };
        picked = true;
      } else if (stepNum === 6 && toolNames.includes("vision_detect")) {
        name = "vision_detect";
        args = { target_object: "绿色柱子" };
        picked = true;
      } else if (stepNum === 7 && toolNames.includes("car_control")) {
        name = "car_control";
        args = { action: "forward", value: 42, unit: "cm", transport: "mock" };
        picked = true;
      } else if (stepNum === 8 && toolNames.includes("arm_release")) {
        name = "arm_release";
        args = { place_hint: "绿色柱子旁边" };
        picked = true;
      }
    }

    if (!picked) {
      if (name === "read_file") args = { path: "package.json" };
      else if (name === "bash") args = { command: "echo mock-ab" };
      else if (name === "skill_call") args = { name: "robot-a-to-b" };
    }

    const tcId = `call_mock_ab_${seq}`;
    const toolCalls = [
      {
        id: tcId,
        type: "function",
        index: 0,
        function: { name, arguments: JSON.stringify(args) }
      }
    ];

    if (lastRole === "user" && lastContent.includes("[步骤")) {
      return jsonResponse(
        completionShell(
          { role: "assistant", content: null, tool_calls: toolCalls },
          "tool_calls"
        )
      );
    }

    return jsonResponse(
      completionShell(
        { role: "assistant", content: `【mock-llm】未识别的执行轮次（lastRole=${lastRole}）。` },
        "stop"
      )
    );
  };
}
