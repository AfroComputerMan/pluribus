// ── Content Blocks ─────────────────────────────────

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ThinkingBlock {
  type: 'thinking';
  thinking: string;
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock | ToolResultBlock;

// ── Stream Event Deltas ────────────────────────────

export interface TextDelta {
  type: 'text_delta';
  text: string;
}

export interface ThinkingDelta {
  type: 'thinking_delta';
  thinking: string;
}

export interface InputJsonDelta {
  type: 'input_json_delta';
  partial_json: string;
}

export type Delta = TextDelta | ThinkingDelta | InputJsonDelta;

// ── Stream Events ──────────────────────────────────

export interface ContentBlockStart {
  type: 'content_block_start';
  index: number;
  content_block: {
    type: 'text' | 'thinking' | 'tool_use';
    id?: string;
    name?: string;
    text?: string;
    thinking?: string;
  };
}

export interface ContentBlockDelta {
  type: 'content_block_delta';
  index: number;
  delta: Delta;
}

export interface ContentBlockStop {
  type: 'content_block_stop';
  index: number;
}

export interface MessageDelta {
  type: 'message_delta';
  delta: {
    stop_reason: string;
  };
  usage?: {
    output_tokens: number;
  };
}

export interface MessageStop {
  type: 'message_stop';
}

export type StreamEventType =
  | ContentBlockStart
  | ContentBlockDelta
  | ContentBlockStop
  | MessageDelta
  | MessageStop;

// ── Top-Level CLI Messages ─────────────────────────

export interface SystemMessage {
  type: 'system';
  subtype: 'init';
  session_id: string;
  model: string;
  tools: Array<{ name: string; type?: string }>;
  mcp_servers?: Array<{ name: string; status: string }>;
}

export interface AssistantMessage {
  type: 'assistant';
  message: {
    id: string;
    role: 'assistant';
    content: ContentBlock[];
    model: string;
    stop_reason: string;
    usage: {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
  };
  session_id: string;
}

export interface UserMessage {
  type: 'user';
  message: {
    role: 'user';
    content: ContentBlock[];
  };
  session_id: string;
}

export interface StreamEventMessage {
  type: 'stream_event';
  event: StreamEventType;
  session_id?: string;
}

export interface ResultMessage {
  type: 'result';
  subtype: 'success' | 'error';
  session_id: string;
  is_error: boolean;
  total_cost_usd: number;
  total_duration_ms: number;
  total_duration_api_ms?: number;
  num_turns: number;
  result?: string;
  error?: string;
}

export type CLIMessage =
  | SystemMessage
  | AssistantMessage
  | UserMessage
  | StreamEventMessage
  | ResultMessage;
