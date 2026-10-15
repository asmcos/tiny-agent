export type ModelToolCall = {
  id: string;
  name: string;
  argumentsJson: string;
};

export type ModelMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      toolCalls?: ModelToolCall[];
      reasoningContent?: string;
    }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type ModelToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ModelRequest = {
  model: string;
  messages: ModelMessage[];
  tools?: ModelToolDefinition[];
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
};

export type ModelResponse = {
  message: Extract<ModelMessage, { role: "assistant" }>;
  finishReason: "stop" | "tool_calls" | "length" | "content_filter" | "unknown";
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  providerRequestId?: string;
};

export interface ModelGateway {
  generate(request: ModelRequest): Promise<ModelResponse>;
}
