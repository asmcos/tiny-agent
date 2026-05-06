/**
 * Example offline `fetch` for OpenAI-style `chat/completions` (smoke / local wiring).
 * Wire with: `TINY_AGENT_MOCK_LLM=1` and
 * `TINY_AGENT_MOCK_LLM_MODULE=examples/agent-mocks/genericMockLlmFetch.ts`.
 */

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

type ChatMessage = Record<string, unknown>;

function completionShell(
  seq: number,
  message: Record<string, unknown>,
  finishReason: string
): Record<string, unknown> {
  return {
    id: `chatcmpl-mock-${seq}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "tiny-agent-example-mock",
    choices: [{ index: 0, message, finish_reason: finishReason }]
  };
}

const EXAMPLE_PLAN_BODY =
  "toolkit: core\n" +
  "1. [SKILL] 如需技能，先用 skill_call 按名称加载对应 skill 全文。\n" +
  "2. [READ] 使用 read_file 查看与任务相关的项目文件。\n" +
  "3. [SHELL] 使用 bash 做一步最小验证。\n" +
  "4. [ANALYZE] 校验结果并收束到下一步。\n" +
  "5. [ANALYZE] 准备最终汇总。\n";

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

    if (!hasTools) {
      if (joined.includes("你是任务规划器")) {
        return jsonResponse(
          completionShell(
            seq,
            {
              role: "assistant",
              content: EXAMPLE_PLAN_BODY
            },
            "stop"
          )
        );
      }
      return jsonResponse(
        completionShell(
          seq,
          {
            role: "assistant",
            content: "【mock-llm】离线假接口：本阶段无工具调用，已结束。"
          },
          "stop"
        )
      );
    }

    if (lastRole === "tool") {
      return jsonResponse(
        completionShell(
          seq,
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

    const skillFromContext = (() => {
      const m = joined.match(/\[skill:([^\]\n"]+)/);
      return m?.[1]?.trim() ?? "";
    })();

    let name = toolNames.includes("read_file") ? "read_file" : toolNames[0] ?? "read_file";
    let args: Record<string, unknown> = {};
    let picked = false;

    if (lastRole === "user" && lastContent.includes("[步骤")) {
      const br = lastContent.indexOf("]");
      const stepLine = (br >= 0 ? lastContent.slice(br + 1) : lastContent).trim();
      const stepLower = stepLine.toLowerCase();

      if (/拍照|拍摄|camera/.test(stepLower) && toolNames.includes("camera_capture")) {
        name = "camera_capture";
        args = { scene_tag: "workarea" };
        picked = true;
      } else if (/识别|定位|detect|vision/.test(stepLower) && toolNames.includes("vision_detect")) {
        name = "vision_detect";
        args = { target_object: "target" };
        picked = true;
      } else if (/抓|捡起|grasp/.test(stepLower) && toolNames.includes("arm_grasp")) {
        name = "arm_grasp";
        args = { target_hint: "target" };
        picked = true;
      } else if (/放入|释放|release/.test(stepLower) && toolNames.includes("arm_release")) {
        name = "arm_release";
        args = { place_hint: "place" };
        picked = true;
      } else if (
        /移动|前进|后退|转|car|底盘/.test(stepLower) &&
        toolNames.includes("car_control")
      ) {
        name = "car_control";
        args = { action: "stop", transport: "mock" };
        picked = true;
      } else if (
        /skill_call|加载.*skill|技能全文|读取.*skill/i.test(stepLine) &&
        toolNames.includes("skill_call")
      ) {
        name = "skill_call";
        const n = skillFromContext || (/\btest_skill\b/.test(joined) ? "test_skill" : "default_skill");
        args = { name: n || "default_skill" };
        picked = true;
      } else if ((/读取|read_file|打开.*文件|package\.json/.test(stepLine) || /read/.test(stepLower)) && toolNames.includes("read_file")) {
        name = "read_file";
        const pathM = stepLine.match(/[\w./\\-]+\.(json|md|ts|txt)\b/);
        args = { path: pathM?.[0] ?? "package.json" };
        picked = true;
      } else if ((/bash|shell|命令|echo/.test(stepLower) || /执行/.test(stepLine)) && toolNames.includes("bash")) {
        name = "bash";
        args = { command: "echo mock-step" };
        picked = true;
      } else if ((/write|写入|保存/.test(stepLower)) && toolNames.includes("write_file")) {
        name = "write_file";
        args = { path: "runs/.mock-write.txt", content: "mock" };
        picked = true;
      }

      if (!picked && toolNames.includes("skill_call") && (skillFromContext || /\bskill\b/i.test(joined))) {
        name = "skill_call";
        args = { name: skillFromContext || "test_skill" };
        picked = true;
      }
    }

    if (!picked) {
      if (name === "read_file") {
        args = { path: "package.json" };
      } else if (name === "bash") {
        args = { command: "echo mock-smoke" };
      } else if (name === "skill_call") {
        args = { name: skillFromContext || "test_skill" };
      } else if (name === "write_file") {
        args = { path: "runs/.mock-write.txt", content: "mock" };
      } else if (name === "car_control") {
        args = { action: "stop", transport: "mock" };
      } else if (name === "camera_capture") {
        args = { scene_tag: "default" };
      } else if (name === "vision_detect") {
        args = { target_object: "target" };
      } else if (name === "arm_grasp") {
        args = { target_hint: "target" };
      } else if (name === "arm_release") {
        args = { place_hint: "place" };
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
          seq,
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
        seq,
        {
          role: "assistant",
          content: `【mock-llm】未识别的执行轮次（lastRole=${lastRole}）。`
        },
        "stop"
      )
    );
  };
}
