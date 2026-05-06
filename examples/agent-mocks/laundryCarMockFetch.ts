/**
 * Scripted OpenAI-compatible `fetch` for demos: laundry pick-place + car hints.
 * Load with: `TINY_AGENT_MOCK_LLM=1` and `TINY_AGENT_MOCK_LLM_MODULE=examples/agent-mocks/laundryCarMockFetch.ts`
 * (path relative to project root; run via `tsx`).
 */

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

type ChatMessage = Record<string, unknown>;

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
      id: `chatcmpl-mock-${seq}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "tiny-agent-demo-mock",
      choices: [{ index: 0, message, finish_reason: finishReason }]
    });

    if (!hasTools) {
      if (joined.includes("你是任务规划器")) {
        const laundryScenario = /衣服|收纳|捡起|放置/.test(joined);
        const planBody = laundryScenario
          ? "toolkit: cars\n" +
            "1. [CAPTURE] 用摄像头拍摄工作区，获取当前画面（用于找黄色衣服）。\n" +
            "2. [VISION] 仅识别黄色衣服，返回位姿/方位+距离（不在此步对收纳筐做可导航的精确定位）。\n" +
            "3. [DRIVE] 移动底盘靠近黄色衣服。\n" +
            "4. [GRASP] 机械臂抓取黄色衣服。\n" +
            "5. [CAPTURE] 抓取完成后再次拍照，更新场景（车体已移动，旧图上的收纳筐位置不可再用于导航）。\n" +
            "6. [VISION] 识别收纳筐并返回位姿/方位+距离，供底盘驶向收纳筐使用。\n" +
            "7. [DRIVE] 移动底盘至收纳筐附近。\n" +
            "8. [RELEASE] 机械臂将衣服释放入收纳筐。\n"
          : "toolkit: core\n" +
            "1. [READ] 读取 package.json 确认项目元信息。\n" +
            "2. [ANALYZE] 执行一步与本任务相关的最小验证。\n" +
            "3. [ANALYZE] 结束并准备汇总。\n";
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
          {
            role: "assistant",
            content: "【mock-llm】离线假接口：全部步骤已跑完。"
          },
          "stop"
        )
      );
    }

    if (lastRole === "tool") {
      return jsonResponse(
        completionShell(
          {
            role: "assistant",
            content: "【mock-llm】本步工具已返回，结束本步。"
          },
          "stop"
        )
      );
    }

    const toolNames = (tools ?? [])
      .map((t) => (t as { function?: { name?: string } }).function?.name)
      .filter((n): n is string => Boolean(n));

    const wantsCar =
      /小车|左转|右转|前进|后退|car_control|10cm|\bdeg\b/i.test(joined) && toolNames.includes("car_control");

    const laundryContext = /衣服|收纳|捡起|放置/.test(joined);

    let name = toolNames.includes("read_file") ? "read_file" : toolNames[0] ?? "read_file";
    let args: Record<string, unknown> = {};
    let picked = false;

    if (lastRole === "user" && lastContent.includes("[步骤") && laundryContext) {
      const br = lastContent.indexOf("]");
      const stepLine = (br >= 0 ? lastContent.slice(br + 1) : lastContent).trim();
      const stepTag = lastContent.match(/\[步骤\s*(\d+)\s*\/\s*(\d+)\]/);
      const stepNum = stepTag ? parseInt(stepTag[1], 10) : 0;

      if (stepNum >= 1 && stepNum <= 8) {
        if (stepNum === 1 && toolNames.includes("camera_capture")) {
          name = "camera_capture";
          args = { scene_tag: "workarea" };
          picked = true;
        } else if (stepNum === 2 && toolNames.includes("vision_detect")) {
          name = "vision_detect";
          args = { target_object: "黄色衣服" };
          picked = true;
        } else if (stepNum === 3 && toolNames.includes("car_control")) {
          name = "car_control";
          args = { action: "forward", value: 35, unit: "cm", transport: "mock" };
          picked = true;
        } else if (stepNum === 4 && toolNames.includes("arm_grasp")) {
          name = "arm_grasp";
          args = { target_hint: "黄色衣服" };
          picked = true;
        } else if (stepNum === 5 && toolNames.includes("camera_capture")) {
          name = "camera_capture";
          args = { scene_tag: "post_grasp" };
          picked = true;
        } else if (stepNum === 6 && toolNames.includes("vision_detect")) {
          name = "vision_detect";
          args = { target_object: "收纳筐" };
          picked = true;
        } else if (stepNum === 7 && toolNames.includes("car_control")) {
          name = "car_control";
          args = { action: "forward", value: 40, unit: "cm", transport: "mock" };
          picked = true;
        } else if (stepNum === 8 && toolNames.includes("arm_release")) {
          name = "arm_release";
          args = { place_hint: "收纳筐" };
          picked = true;
        }
      }

      if (!picked) {
        if (/拍摄|摄像头|拍照/.test(stepLine) && toolNames.includes("camera_capture")) {
          name = "camera_capture";
          args = { scene_tag: "workarea" };
          picked = true;
        } else if (/识别收纳筐/.test(stepLine) && toolNames.includes("vision_detect")) {
          name = "vision_detect";
          args = { target_object: "收纳筐" };
          picked = true;
        } else if (/识别.*黄色衣服/.test(stepLine) && !/收纳筐/.test(stepLine) && toolNames.includes("vision_detect")) {
          name = "vision_detect";
          args = { target_object: "黄色衣服" };
          picked = true;
        } else if (/识别|定位/.test(stepLine) && toolNames.includes("vision_detect")) {
          name = "vision_detect";
          args = { target_object: "黄色衣服", also_find: "收纳筐" };
          picked = true;
        } else if (
          (/靠近黄色衣服|移动.*黄色衣服|底盘.*黄色衣服|移动底盘靠近黄色衣服/.test(stepLine)) &&
          toolNames.includes("car_control")
        ) {
          name = "car_control";
          args = { action: "forward", value: 35, unit: "cm", transport: "mock" };
          picked = true;
        } else if (
          (/抓取|捡起|机械臂.*抓|抓.*黄色衣服/.test(stepLine)) &&
          toolNames.includes("arm_grasp")
        ) {
          name = "arm_grasp";
          args = { target_hint: "黄色衣服" };
          picked = true;
        } else if (
          (/收纳筐附近|移动.*收纳筐|底盘.*收纳筐|移动底盘至收纳筐/.test(stepLine)) &&
          toolNames.includes("car_control")
        ) {
          name = "car_control";
          args = { action: "forward", value: 40, unit: "cm", transport: "mock" };
          picked = true;
        } else if ((/释放|放入|释放入|卸下/.test(stepLine)) && toolNames.includes("arm_release")) {
          name = "arm_release";
          args = { place_hint: "收纳筐" };
          picked = true;
        }
      }
    }

    if (!picked && wantsCar) {
      name = "car_control";
      args = { action: "stop", transport: "mock" };
      picked = true;
    }

    if (!picked) {
      if (name === "read_file") {
        args = { path: "package.json" };
      } else if (name === "bash") {
        args = { command: "echo mock-smoke" };
      } else if (name === "skill_call") {
        args = { name: "test_skill" };
      } else if (name === "write_file") {
        args = { path: "runs/.mock-write.txt", content: "mock" };
      }
    }

    const tcId = `call_mock_${seq}`;
    const toolCalls = [
      {
        id: tcId,
        type: "function",
        index: 0,
        function: {
          name,
          arguments: JSON.stringify(args)
        }
      }
    ];

    if (lastRole === "user" && lastContent.includes("[步骤")) {
      return jsonResponse(
        completionShell(
          {
            role: "assistant",
            content: null,
            tool_calls: toolCalls
          },
          "tool_calls"
        )
      );
    }

    return jsonResponse(
      completionShell(
        {
          role: "assistant",
          content: `【mock-llm】未识别的执行轮次（lastRole=${lastRole}）。`
        },
        "stop"
      )
    );
  };
}
