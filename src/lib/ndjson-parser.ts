import type { CLIMessage, StreamEventMessage } from '../types/cli';

/**
 * Parse a single NDJSON line from the Claude CLI.
 * Returns null for empty lines or unparseable content (graceful degradation).
 */
export function parseCLILine(line: string): CLIMessage | null {
  const trimmed = line.trim();
  if (!trimmed) return null;

  try {
    const parsed = JSON.parse(trimmed);

    // Validate it has a type field
    if (!parsed || typeof parsed.type !== 'string') {
      console.warn('[ndjson-parser] Missing type field:', trimmed.slice(0, 100));
      return null;
    }

    // Validate known types
    const knownTypes = ['system', 'assistant', 'user', 'stream_event', 'result'];
    if (!knownTypes.includes(parsed.type)) {
      console.warn('[ndjson-parser] Unknown message type:', parsed.type);
      return null;  // Graceful skip — don't crash on unknown types
    }

    return parsed as CLIMessage;
  } catch (e) {
    console.warn('[ndjson-parser] Failed to parse line:', trimmed.slice(0, 100), e);
    return null;
  }
}

// ── UI Actions ─────────────────────────────────────

export type UIAction =
  | { type: 'init_session'; sessionId: string; model: string; tools: Array<{ name: string }> }
  | { type: 'start_text_block'; index: number }
  | { type: 'start_thinking_block'; index: number }
  | { type: 'start_tool_use_block'; index: number; toolName: string; toolUseId: string }
  | { type: 'append_text'; index: number; text: string }
  | { type: 'append_thinking'; index: number; thinking: string }
  | { type: 'append_tool_input'; index: number; partialJson: string }
  | { type: 'complete_block'; index: number }
  | { type: 'finalize_assistant_turn'; message: CLIMessage & { type: 'assistant' } }
  | { type: 'add_tool_result'; toolUseId: string; content: string; isError: boolean }
  | { type: 'session_complete'; sessionId: string; totalCost: number; numTurns: number; durationMs: number }
  | { type: 'session_error'; sessionId: string; error: string }
  | { type: 'message_stop' };

/**
 * Map a parsed CLIMessage to zero or more UIActions.
 * This is the bridge between CLI output format and UI state updates.
 */
export function cliMessageToUIActions(msg: CLIMessage): UIAction[] {
  switch (msg.type) {
    case 'system': {
      if (msg.subtype === 'init') {
        return [{
          type: 'init_session',
          sessionId: msg.session_id,
          model: msg.model,
          tools: msg.tools,
        }];
      }
      return [];
    }

    case 'stream_event': {
      return handleStreamEvent(msg);
    }

    case 'assistant': {
      return [{
        type: 'finalize_assistant_turn',
        message: msg,
      }];
    }

    case 'user': {
      // User messages with tool_result content
      const actions: UIAction[] = [];
      for (const block of msg.message.content) {
        if (block.type === 'tool_result') {
          actions.push({
            type: 'add_tool_result',
            toolUseId: block.tool_use_id,
            content: block.content,
            isError: block.is_error ?? false,
          });
        }
      }
      return actions;
    }

    case 'result': {
      if (msg.subtype === 'success') {
        return [{
          type: 'session_complete',
          sessionId: msg.session_id,
          totalCost: msg.total_cost_usd,
          numTurns: msg.num_turns,
          durationMs: msg.total_duration_ms,
        }];
      } else {
        return [{
          type: 'session_error',
          sessionId: msg.session_id,
          error: msg.error ?? 'Unknown error',
        }];
      }
    }

    default:
      return [];
  }
}

function handleStreamEvent(msg: StreamEventMessage): UIAction[] {
  const event = msg.event;

  switch (event.type) {
    case 'content_block_start': {
      const block = event.content_block;
      if (block.type === 'text') {
        return [{ type: 'start_text_block', index: event.index }];
      }
      if (block.type === 'thinking') {
        return [{ type: 'start_thinking_block', index: event.index }];
      }
      if (block.type === 'tool_use') {
        return [{
          type: 'start_tool_use_block',
          index: event.index,
          toolName: block.name ?? 'unknown',
          toolUseId: block.id ?? '',
        }];
      }
      return [];
    }

    case 'content_block_delta': {
      const delta = event.delta;
      if (delta.type === 'text_delta') {
        return [{ type: 'append_text', index: event.index, text: delta.text }];
      }
      if (delta.type === 'thinking_delta') {
        return [{ type: 'append_thinking', index: event.index, thinking: delta.thinking }];
      }
      if (delta.type === 'input_json_delta') {
        return [{ type: 'append_tool_input', index: event.index, partialJson: delta.partial_json }];
      }
      return [];
    }

    case 'content_block_stop': {
      return [{ type: 'complete_block', index: event.index }];
    }

    case 'message_stop': {
      return [{ type: 'message_stop' }];
    }

    case 'message_delta': {
      // Could track stop_reason if needed
      return [];
    }

    default:
      return [];
  }
}
