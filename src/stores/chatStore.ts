import { create } from 'zustand';
import type { ChatMessage, StreamingContentBlock, StreamingState } from '../types/chat';
import type { UIAction } from '../lib/ndjson-parser';
import type { AssistantMessage } from '../types/cli';

function createEmptyStreamingState(sessionId: string): StreamingState {
  return {
    isStreaming: false,
    sessionId,
    contentBlocks: [],
    currentBlockIndex: -1,
  };
}

function nextOrderIndex(messages: ChatMessage[]): number {
  const last = messages[messages.length - 1];
  return last ? last.orderIndex + 1 : 0;
}

/**
 * Convert finalized assistant message content blocks into ChatMessages.
 */
function assistantToChatMessages(
  msg: AssistantMessage,
  startIndex: number,
): ChatMessage[] {
  const now = new Date().toISOString();
  const results: ChatMessage[] = [];
  const { message } = msg;

  // Group text/thinking blocks into a single message, tool_use blocks become separate messages
  let textContent = '';
  let thinkingContent = '';

  for (const block of message.content) {
    if (block.type === 'text') {
      textContent += block.text;
    } else if (block.type === 'thinking') {
      thinkingContent += block.thinking;
    } else if (block.type === 'tool_use') {
      // Flush any accumulated text first
      if (textContent || thinkingContent) {
        results.push({
          id: `${message.id}-text-${results.length}`,
          sessionId: msg.session_id,
          role: 'assistant',
          content: textContent || thinkingContent,
          contentType: 'markdown',
          model: message.model,
          inputTokens: results.length === 0 ? message.usage.input_tokens : undefined,
          outputTokens: results.length === 0 ? message.usage.output_tokens : undefined,
          orderIndex: startIndex + results.length,
          createdAt: now,
        });
        textContent = '';
        thinkingContent = '';
      }

      results.push({
        id: `${message.id}-tool-${block.id}`,
        sessionId: msg.session_id,
        role: 'tool_use',
        content: JSON.stringify(block.input),
        contentType: 'json',
        toolName: block.name,
        toolInput: block.input,
        toolUseId: block.id,
        model: message.model,
        orderIndex: startIndex + results.length,
        createdAt: now,
      });
    }
  }

  // Flush remaining text
  if (textContent || thinkingContent || results.length === 0) {
    results.push({
      id: `${message.id}-text-${results.length}`,
      sessionId: msg.session_id,
      role: 'assistant',
      content: textContent || thinkingContent,
      contentType: 'markdown',
      model: message.model,
      inputTokens: results.length === 0 ? message.usage.input_tokens : undefined,
      outputTokens: results.length === 0 ? message.usage.output_tokens : undefined,
      orderIndex: startIndex + results.length,
      createdAt: now,
    });
  }

  return results;
}

interface ChatState {
  messages: Record<string, ChatMessage[]>;
  streamingState: Record<string, StreamingState>;

  dispatch: (sessionId: string, action: UIAction) => void;
  clearSession: (sessionId: string) => void;
  loadMessages: (sessionId: string, messages: ChatMessage[]) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: {},
  streamingState: {},

  dispatch: (sessionId, action) => {
    const state = get();

    switch (action.type) {
      case 'init_session': {
        set({
          messages: {
            ...state.messages,
            [sessionId]: state.messages[sessionId] ?? [],
          },
          streamingState: {
            ...state.streamingState,
            [sessionId]: { ...createEmptyStreamingState(sessionId), isStreaming: true },
          },
        });
        break;
      }

      case 'start_text_block': {
        const ss = state.streamingState[sessionId];
        if (!ss) break;
        const block: StreamingContentBlock = {
          index: action.index,
          type: 'text',
          content: '',
          isComplete: false,
        };
        set({
          streamingState: {
            ...state.streamingState,
            [sessionId]: {
              ...ss,
              contentBlocks: [...ss.contentBlocks, block],
              currentBlockIndex: action.index,
            },
          },
        });
        break;
      }

      case 'start_thinking_block': {
        const ss = state.streamingState[sessionId];
        if (!ss) break;
        const block: StreamingContentBlock = {
          index: action.index,
          type: 'thinking',
          content: '',
          isComplete: false,
        };
        set({
          streamingState: {
            ...state.streamingState,
            [sessionId]: {
              ...ss,
              contentBlocks: [...ss.contentBlocks, block],
              currentBlockIndex: action.index,
            },
          },
        });
        break;
      }

      case 'start_tool_use_block': {
        const ss = state.streamingState[sessionId];
        if (!ss) break;
        const block: StreamingContentBlock = {
          index: action.index,
          type: 'tool_use',
          content: '',
          toolName: action.toolName,
          toolUseId: action.toolUseId,
          toolInput: '',
          isComplete: false,
        };
        set({
          streamingState: {
            ...state.streamingState,
            [sessionId]: {
              ...ss,
              contentBlocks: [...ss.contentBlocks, block],
              currentBlockIndex: action.index,
            },
          },
        });
        break;
      }

      case 'append_text': {
        const ss = state.streamingState[sessionId];
        if (!ss) break;
        const blocks = ss.contentBlocks.map((b) =>
          b.index === action.index ? { ...b, content: b.content + action.text } : b,
        );
        set({
          streamingState: {
            ...state.streamingState,
            [sessionId]: { ...ss, contentBlocks: blocks },
          },
        });
        break;
      }

      case 'append_thinking': {
        const ss = state.streamingState[sessionId];
        if (!ss) break;
        const blocks = ss.contentBlocks.map((b) =>
          b.index === action.index ? { ...b, content: b.content + action.thinking } : b,
        );
        set({
          streamingState: {
            ...state.streamingState,
            [sessionId]: { ...ss, contentBlocks: blocks },
          },
        });
        break;
      }

      case 'append_tool_input': {
        const ss = state.streamingState[sessionId];
        if (!ss) break;
        const blocks = ss.contentBlocks.map((b) =>
          b.index === action.index
            ? { ...b, toolInput: (b.toolInput ?? '') + action.partialJson }
            : b,
        );
        set({
          streamingState: {
            ...state.streamingState,
            [sessionId]: { ...ss, contentBlocks: blocks },
          },
        });
        break;
      }

      case 'complete_block': {
        const ss = state.streamingState[sessionId];
        if (!ss) break;
        const blocks = ss.contentBlocks.map((b) =>
          b.index === action.index ? { ...b, isComplete: true } : b,
        );
        set({
          streamingState: {
            ...state.streamingState,
            [sessionId]: { ...ss, contentBlocks: blocks },
          },
        });
        break;
      }

      case 'message_stop': {
        const ss = state.streamingState[sessionId];
        if (!ss) break;
        set({
          streamingState: {
            ...state.streamingState,
            [sessionId]: { ...ss, isStreaming: false },
          },
        });
        break;
      }

      case 'finalize_assistant_turn': {
        const sessionMessages = state.messages[sessionId] ?? [];
        const start = nextOrderIndex(sessionMessages);
        const newMessages = assistantToChatMessages(action.message, start);
        set({
          messages: {
            ...state.messages,
            [sessionId]: [...sessionMessages, ...newMessages],
          },
          streamingState: {
            ...state.streamingState,
            [sessionId]: createEmptyStreamingState(sessionId),
          },
        });
        break;
      }

      case 'add_tool_result': {
        const sessionMessages = state.messages[sessionId] ?? [];
        const toolResult: ChatMessage = {
          id: `tool-result-${action.toolUseId}-${Date.now()}`,
          sessionId,
          role: 'tool_result',
          content: action.content,
          contentType: action.isError ? 'text' : 'json',
          toolUseId: action.toolUseId,
          isError: action.isError,
          orderIndex: nextOrderIndex(sessionMessages),
          createdAt: new Date().toISOString(),
        };
        set({
          messages: {
            ...state.messages,
            [sessionId]: [...sessionMessages, toolResult],
          },
        });
        break;
      }

      case 'session_complete': {
        // Streaming is done; clear streaming state
        set({
          streamingState: {
            ...state.streamingState,
            [sessionId]: createEmptyStreamingState(sessionId),
          },
        });
        break;
      }

      case 'session_error': {
        const sessionMessages = state.messages[sessionId] ?? [];
        const errorMsg: ChatMessage = {
          id: `error-${sessionId}-${Date.now()}`,
          sessionId,
          role: 'system',
          content: action.error,
          contentType: 'text',
          isError: true,
          orderIndex: nextOrderIndex(sessionMessages),
          createdAt: new Date().toISOString(),
        };
        set({
          messages: {
            ...state.messages,
            [sessionId]: [...sessionMessages, errorMsg],
          },
          streamingState: {
            ...state.streamingState,
            [sessionId]: createEmptyStreamingState(sessionId),
          },
        });
        break;
      }
    }
  },

  clearSession: (sessionId) => {
    const state = get();
    const { [sessionId]: _msgs, ...restMessages } = state.messages;
    const { [sessionId]: _ss, ...restStreaming } = state.streamingState;
    set({
      messages: restMessages,
      streamingState: restStreaming,
    });
  },

  loadMessages: (sessionId, messages) => {
    set((state) => ({
      messages: { ...state.messages, [sessionId]: messages },
    }));
  },
}));
