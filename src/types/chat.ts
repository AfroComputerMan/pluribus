export type MessageRole = 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result';
export type SessionStatus = 'created' | 'running' | 'completed' | 'failed' | 'killed' | 'paused';

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  contentType: 'text' | 'markdown' | 'code' | 'json';
  toolName?: string;
  toolInput?: Record<string, unknown>;
  toolUseId?: string;
  isError?: boolean;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  orderIndex: number;
  createdAt: string;
}

export interface StreamingContentBlock {
  index: number;
  type: 'text' | 'thinking' | 'tool_use';
  content: string;        // Accumulated text/thinking content
  toolName?: string;      // For tool_use blocks
  toolUseId?: string;     // For tool_use blocks
  toolInput?: string;     // Accumulated JSON input (raw string)
  isComplete: boolean;
}

export interface StreamingState {
  isStreaming: boolean;
  sessionId: string | null;
  contentBlocks: StreamingContentBlock[];
  currentBlockIndex: number;
}
