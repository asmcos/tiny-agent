import OpenAI from "openai";
import { AppError } from "../shared/errors";
import { ensureOpenAIBaseUrl } from "../config";
import type { ModelGateway, ModelMessage, ModelRequest, ModelResponse, ModelToolCall } from "./contracts";

export type OpenAIAdapterOptions = {
  apiKey: string;
  baseURL: string;
  defaultModel: string;
  temperature?: number;
  maxOutputTokens?: number;
  headers?: Record<string, string>;
};

export class OpenAICompatibleGateway implements ModelGateway {
  private readonly client: OpenAI;
  readonly defaultModel: string;
  private readonly temperature: number;
  private readonly maxOutputTokens: number;

  constructor(opts: OpenAIAdapterOptions) {
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: ensureOpenAIBaseUrl(opts.baseURL),
      defaultHeaders: {
        "User-Agent": "tiny-agent/0.2.0",
        ...opts.headers
      }
    });
    this.defaultModel = opts.defaultModel;
    this.temperature = opts.temperature ?? 0.2;
    this.maxOutputTokens = opts.maxOutputTokens ?? 4096;
  }

  async listModels(): Promise<Array<{ id: string }>> {
    const page = await this.client.models.list();
    const models: Array<{ id: string }> = [];
    for await (const model of page) {
      if (model.id) models.push({ id: model.id });
    }
    return models;
  }

  async generate(request: ModelRequest): Promise<ModelResponse> {
    try {
      const completion = await this.client.chat.completions.create(
        {
          model: request.model || this.defaultModel,
          temperature: request.temperature ?? this.temperature,
          max_tokens: request.maxOutputTokens ?? this.maxOutputTokens,
          messages: request.messages.map(toOpenAIMessage),
          ...(request.tools?.length
            ? {
                tools: request.tools.map((tool) => ({
                  type: "function" as const,
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.inputSchema
                  }
                }))
              }
            : {})
        },
        { signal: request.signal }
      );
      const choice = completion.choices[0];
      const message = choice?.message;
      if (!message) throw new AppError("INVALID_MODEL_RESPONSE", "模型响应没有 message");
      const toolCalls = (message.tool_calls ?? [])
        .filter((call) => call.type === "function")
        .map(toToolCall);
      const reasoning = (message as { reasoning_content?: string }).reasoning_content;
      return {
        message: {
          role: "assistant",
          content: message.content ?? "",
          ...(toolCalls.length ? { toolCalls } : {}),
          ...(reasoning ? { reasoningContent: reasoning } : {})
        },
        finishReason: mapFinish(choice?.finish_reason),
        usage: completion.usage
          ? {
              inputTokens: completion.usage.prompt_tokens,
              outputTokens: completion.usage.completion_tokens,
              totalTokens: completion.usage.total_tokens
            }
          : undefined,
        providerRequestId: completion.id
      };
    } catch (error) {
      throw classifyProviderError(error);
    }
  }
}

function toToolCall(call: {
  id: string;
  function: { name: string; arguments?: string };
}): ModelToolCall {
  return {
    id: call.id,
    name: call.function.name,
    argumentsJson: call.function.arguments ?? "{}"
  };
}

function toOpenAIMessage(message: ModelMessage): OpenAI.Chat.Completions.ChatCompletionMessageParam {
  if (message.role === "system") return { role: "system", content: message.content };
  if (message.role === "user") return { role: "user", content: message.content };
  if (message.role === "tool") {
    return { role: "tool", tool_call_id: message.toolCallId, content: message.content };
  }
  return {
    role: "assistant",
    content: message.content,
    ...(message.toolCalls?.length
      ? {
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: "function" as const,
            function: { name: call.name, arguments: call.argumentsJson }
          }))
        }
      : {}),
    ...(message.reasoningContent ? { reasoning_content: message.reasoningContent } : {})
  } as OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam;
}

function mapFinish(reason: string | null | undefined): ModelResponse["finishReason"] {
  if (reason === "stop" || reason === "tool_calls" || reason === "length" || reason === "content_filter") {
    return reason;
  }
  return "unknown";
}

function classifyProviderError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  const status = (error as { status?: number }).status;
  const message = error instanceof Error ? error.message : String(error);
  if (status === 401) return new AppError("PROVIDER_AUTH_FAILED", "模型鉴权失败", { retryable: false });
  if (status === 404) return new AppError("MODEL_NOT_FOUND", message);
  if (status === 429) return new AppError("PROVIDER_RATE_LIMITED", "模型限流", { retryable: true });
  if (status === 400 && /context|token/i.test(message)) {
    return new AppError("CONTEXT_TOO_LARGE", message, { retryable: true });
  }
  return new AppError("PROVIDER_UNAVAILABLE", message, { retryable: true });
}
