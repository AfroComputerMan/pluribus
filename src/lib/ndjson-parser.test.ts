import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseCLILine, cliMessageToUIActions, type UIAction } from './ndjson-parser';

describe('parseCLILine', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it('returns null for empty string', () => {
    const result = parseCLILine('');
    expect(result).toBeNull();
  });

  it('returns null for whitespace-only string', () => {
    const result = parseCLILine('   \n\t  ');
    expect(result).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    const result = parseCLILine('not valid json {]');
    expect(result).toBeNull();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[ndjson-parser] Failed to parse line:',
      expect.any(String),
      expect.any(Error)
    );
  });

  it('returns null for JSON without type field', () => {
    const result = parseCLILine('{"foo": "bar"}');
    expect(result).toBeNull();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[ndjson-parser] Missing type field:',
      '{"foo": "bar"}'
    );
  });

  it('returns null for unknown type (graceful)', () => {
    const result = parseCLILine('{"type": "unknown_message_type"}');
    expect(result).toBeNull();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[ndjson-parser] Unknown message type:',
      'unknown_message_type'
    );
  });

  it('parses system init message', () => {
    const json = JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 'sess_123',
      model: 'claude-sonnet-4-5-20250929',
      tools: [{ name: 'Read' }, { name: 'Write' }],
      mcp_servers: [{ name: 'filesystem', status: 'connected' }]
    });
    const result = parseCLILine(json);

    expect(result).toEqual({
      type: 'system',
      subtype: 'init',
      session_id: 'sess_123',
      model: 'claude-sonnet-4-5-20250929',
      tools: [{ name: 'Read' }, { name: 'Write' }],
      mcp_servers: [{ name: 'filesystem', status: 'connected' }]
    });
  });

  it('parses assistant message', () => {
    const json = JSON.stringify({
      type: 'assistant',
      session_id: 'sess_123',
      message: {
        id: 'msg_abc',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Hello world' }
        ],
        model: 'claude-sonnet-4-5-20250929',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 20
        }
      }
    });
    const result = parseCLILine(json);

    expect(result).toMatchObject({
      type: 'assistant',
      session_id: 'sess_123',
      message: {
        id: 'msg_abc',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello world' }]
      }
    });
  });

  it('parses user message with tool_result', () => {
    const json = JSON.stringify({
      type: 'user',
      session_id: 'sess_123',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool_xyz',
            content: 'File contents here',
            is_error: false
          }
        ]
      }
    });
    const result = parseCLILine(json);

    expect(result).toMatchObject({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool_xyz',
            content: 'File contents here'
          }
        ]
      }
    });
  });

  it('parses stream_event content_block_start (text)', () => {
    const json = JSON.stringify({
      type: 'stream_event',
      session_id: 'sess_123',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text' }
      }
    });
    const result = parseCLILine(json);

    expect(result).toMatchObject({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text' }
      }
    });
  });

  it('parses stream_event content_block_start (thinking)', () => {
    const json = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'thinking' }
      }
    });
    const result = parseCLILine(json);

    expect(result).toMatchObject({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'thinking' }
      }
    });
  });

  it('parses stream_event content_block_start (tool_use)', () => {
    const json = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 2,
        content_block: {
          type: 'tool_use',
          id: 'tool_abc',
          name: 'Read'
        }
      }
    });
    const result = parseCLILine(json);

    expect(result).toMatchObject({
      type: 'stream_event',
      event: {
        type: 'content_block_start',
        index: 2,
        content_block: {
          type: 'tool_use',
          id: 'tool_abc',
          name: 'Read'
        }
      }
    });
  });

  it('parses stream_event content_block_delta (text_delta)', () => {
    const json = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: {
          type: 'text_delta',
          text: 'Hello'
        }
      }
    });
    const result = parseCLILine(json);

    expect(result).toMatchObject({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' }
      }
    });
  });

  it('parses stream_event content_block_delta (thinking_delta)', () => {
    const json = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: {
          type: 'thinking_delta',
          thinking: 'Let me consider...'
        }
      }
    });
    const result = parseCLILine(json);

    expect(result).toMatchObject({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'thinking_delta', thinking: 'Let me consider...' }
      }
    });
  });

  it('parses stream_event content_block_delta (input_json_delta)', () => {
    const json = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 2,
        delta: {
          type: 'input_json_delta',
          partial_json: '{"file_path":'
        }
      }
    });
    const result = parseCLILine(json);

    expect(result).toMatchObject({
      type: 'stream_event',
      event: {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'input_json_delta', partial_json: '{"file_path":' }
      }
    });
  });

  it('parses stream_event content_block_stop', () => {
    const json = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'content_block_stop',
        index: 0
      }
    });
    const result = parseCLILine(json);

    expect(result).toMatchObject({
      type: 'stream_event',
      event: {
        type: 'content_block_stop',
        index: 0
      }
    });
  });

  it('parses stream_event message_delta', () => {
    const json = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'message_delta',
        delta: {
          stop_reason: 'end_turn'
        },
        usage: {
          output_tokens: 150
        }
      }
    });
    const result = parseCLILine(json);

    expect(result).toMatchObject({
      type: 'stream_event',
      event: {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 150 }
      }
    });
  });

  it('parses stream_event message_stop', () => {
    const json = JSON.stringify({
      type: 'stream_event',
      event: {
        type: 'message_stop'
      }
    });
    const result = parseCLILine(json);

    expect(result).toMatchObject({
      type: 'stream_event',
      event: {
        type: 'message_stop'
      }
    });
  });

  it('parses result success', () => {
    const json = JSON.stringify({
      type: 'result',
      subtype: 'success',
      session_id: 'sess_123',
      is_error: false,
      total_cost_usd: 0.0042,
      total_duration_ms: 3500,
      total_duration_api_ms: 2800,
      num_turns: 3,
      result: 'Task completed successfully'
    });
    const result = parseCLILine(json);

    expect(result).toEqual({
      type: 'result',
      subtype: 'success',
      session_id: 'sess_123',
      is_error: false,
      total_cost_usd: 0.0042,
      total_duration_ms: 3500,
      total_duration_api_ms: 2800,
      num_turns: 3,
      result: 'Task completed successfully'
    });
  });

  it('parses result error', () => {
    const json = JSON.stringify({
      type: 'result',
      subtype: 'error',
      session_id: 'sess_123',
      is_error: true,
      total_cost_usd: 0.001,
      total_duration_ms: 1200,
      num_turns: 1,
      error: 'API rate limit exceeded'
    });
    const result = parseCLILine(json);

    expect(result).toEqual({
      type: 'result',
      subtype: 'error',
      session_id: 'sess_123',
      is_error: true,
      total_cost_usd: 0.001,
      total_duration_ms: 1200,
      num_turns: 1,
      error: 'API rate limit exceeded'
    });
  });

  it('logs warning for unparseable line', () => {
    parseCLILine('{"incomplete": ');
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      '[ndjson-parser] Failed to parse line:',
      expect.any(String),
      expect.any(Error)
    );
  });
});

describe('cliMessageToUIActions', () => {
  it('maps system init to init_session', () => {
    const msg = {
      type: 'system' as const,
      subtype: 'init' as const,
      session_id: 'sess_456',
      model: 'claude-sonnet-4-5-20250929',
      tools: [{ name: 'Read' }, { name: 'Bash' }]
    };

    const actions = cliMessageToUIActions(msg);

    expect(actions).toEqual([{
      type: 'init_session',
      sessionId: 'sess_456',
      model: 'claude-sonnet-4-5-20250929',
      tools: [{ name: 'Read' }, { name: 'Bash' }]
    }]);
  });

  it('maps content_block_start text to start_text_block', () => {
    const msg = {
      type: 'stream_event' as const,
      event: {
        type: 'content_block_start' as const,
        index: 0,
        content_block: { type: 'text' as const }
      }
    };

    const actions = cliMessageToUIActions(msg);

    expect(actions).toEqual([{
      type: 'start_text_block',
      index: 0
    }]);
  });

  it('maps content_block_start thinking to start_thinking_block', () => {
    const msg = {
      type: 'stream_event' as const,
      event: {
        type: 'content_block_start' as const,
        index: 1,
        content_block: { type: 'thinking' as const }
      }
    };

    const actions = cliMessageToUIActions(msg);

    expect(actions).toEqual([{
      type: 'start_thinking_block',
      index: 1
    }]);
  });

  it('maps content_block_start tool_use to start_tool_use_block', () => {
    const msg = {
      type: 'stream_event' as const,
      event: {
        type: 'content_block_start' as const,
        index: 2,
        content_block: {
          type: 'tool_use' as const,
          id: 'tool_789',
          name: 'Read'
        }
      }
    };

    const actions = cliMessageToUIActions(msg);

    expect(actions).toEqual([{
      type: 'start_tool_use_block',
      index: 2,
      toolName: 'Read',
      toolUseId: 'tool_789'
    }]);
  });

  it('maps content_block_delta text_delta to append_text', () => {
    const msg = {
      type: 'stream_event' as const,
      event: {
        type: 'content_block_delta' as const,
        index: 0,
        delta: {
          type: 'text_delta' as const,
          text: 'Hello'
        }
      }
    };

    const actions = cliMessageToUIActions(msg);

    expect(actions).toEqual([{
      type: 'append_text',
      index: 0,
      text: 'Hello'
    }]);
  });

  it('maps content_block_delta thinking_delta to append_thinking', () => {
    const msg = {
      type: 'stream_event' as const,
      event: {
        type: 'content_block_delta' as const,
        index: 1,
        delta: {
          type: 'thinking_delta' as const,
          thinking: 'I need to analyze...'
        }
      }
    };

    const actions = cliMessageToUIActions(msg);

    expect(actions).toEqual([{
      type: 'append_thinking',
      index: 1,
      thinking: 'I need to analyze...'
    }]);
  });

  it('maps content_block_delta input_json_delta to append_tool_input', () => {
    const msg = {
      type: 'stream_event' as const,
      event: {
        type: 'content_block_delta' as const,
        index: 2,
        delta: {
          type: 'input_json_delta' as const,
          partial_json: '{"file_path": "/home/user/file.txt"}'
        }
      }
    };

    const actions = cliMessageToUIActions(msg);

    expect(actions).toEqual([{
      type: 'append_tool_input',
      index: 2,
      partialJson: '{"file_path": "/home/user/file.txt"}'
    }]);
  });

  it('maps content_block_stop to complete_block', () => {
    const msg = {
      type: 'stream_event' as const,
      event: {
        type: 'content_block_stop' as const,
        index: 0
      }
    };

    const actions = cliMessageToUIActions(msg);

    expect(actions).toEqual([{
      type: 'complete_block',
      index: 0
    }]);
  });

  it('maps assistant message to finalize_assistant_turn', () => {
    const msg = {
      type: 'assistant' as const,
      session_id: 'sess_123',
      message: {
        id: 'msg_xyz',
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: 'Response text' }],
        model: 'claude-sonnet-4-5-20250929',
        stop_reason: 'end_turn',
        usage: {
          input_tokens: 200,
          output_tokens: 100
        }
      }
    };

    const actions = cliMessageToUIActions(msg);

    expect(actions).toEqual([{
      type: 'finalize_assistant_turn',
      message: msg
    }]);
  });

  it('maps user tool_result to add_tool_result', () => {
    const msg = {
      type: 'user' as const,
      session_id: 'sess_123',
      message: {
        role: 'user' as const,
        content: [
          {
            type: 'tool_result' as const,
            tool_use_id: 'tool_abc',
            content: 'File contents from tool',
            is_error: false
          }
        ]
      }
    };

    const actions = cliMessageToUIActions(msg);

    expect(actions).toEqual([{
      type: 'add_tool_result',
      toolUseId: 'tool_abc',
      content: 'File contents from tool',
      isError: false
    }]);
  });

  it('maps user tool_result with error to add_tool_result with isError', () => {
    const msg = {
      type: 'user' as const,
      session_id: 'sess_123',
      message: {
        role: 'user' as const,
        content: [
          {
            type: 'tool_result' as const,
            tool_use_id: 'tool_def',
            content: 'Error: File not found',
            is_error: true
          }
        ]
      }
    };

    const actions = cliMessageToUIActions(msg);

    expect(actions).toEqual([{
      type: 'add_tool_result',
      toolUseId: 'tool_def',
      content: 'Error: File not found',
      isError: true
    }]);
  });

  it('maps result success to session_complete', () => {
    const msg = {
      type: 'result' as const,
      subtype: 'success' as const,
      session_id: 'sess_789',
      is_error: false,
      total_cost_usd: 0.0035,
      total_duration_ms: 4200,
      num_turns: 5
    };

    const actions = cliMessageToUIActions(msg);

    expect(actions).toEqual([{
      type: 'session_complete',
      sessionId: 'sess_789',
      totalCost: 0.0035,
      numTurns: 5,
      durationMs: 4200
    }]);
  });

  it('maps result error to session_error', () => {
    const msg = {
      type: 'result' as const,
      subtype: 'error' as const,
      session_id: 'sess_999',
      is_error: true,
      total_cost_usd: 0.001,
      total_duration_ms: 800,
      num_turns: 1,
      error: 'Authentication failed'
    };

    const actions = cliMessageToUIActions(msg);

    expect(actions).toEqual([{
      type: 'session_error',
      sessionId: 'sess_999',
      error: 'Authentication failed'
    }]);
  });

  it('maps result error without error field to session_error with default message', () => {
    const msg = {
      type: 'result' as const,
      subtype: 'error' as const,
      session_id: 'sess_888',
      is_error: true,
      total_cost_usd: 0.0,
      total_duration_ms: 100,
      num_turns: 0
    };

    const actions = cliMessageToUIActions(msg);

    expect(actions).toEqual([{
      type: 'session_error',
      sessionId: 'sess_888',
      error: 'Unknown error'
    }]);
  });

  it('maps message_stop to message_stop', () => {
    const msg = {
      type: 'stream_event' as const,
      event: {
        type: 'message_stop' as const
      }
    };

    const actions = cliMessageToUIActions(msg);

    expect(actions).toEqual([{
      type: 'message_stop'
    }]);
  });

  it('returns empty array for message_delta', () => {
    const msg = {
      type: 'stream_event' as const,
      event: {
        type: 'message_delta' as const,
        delta: {
          stop_reason: 'end_turn'
        },
        usage: {
          output_tokens: 50
        }
      }
    };

    const actions = cliMessageToUIActions(msg);

    expect(actions).toEqual([]);
  });

  it('returns empty array for unknown stream event type', () => {
    const msg = {
      type: 'stream_event' as const,
      event: {
        type: 'content_block_start' as const,
        index: 0,
        content_block: { type: 'unknown_type' as any }
      }
    };

    const actions = cliMessageToUIActions(msg as any);

    expect(actions).toEqual([]);
  });

  it('handles user message with multiple tool_results', () => {
    const msg = {
      type: 'user' as const,
      session_id: 'sess_multi',
      message: {
        role: 'user' as const,
        content: [
          {
            type: 'tool_result' as const,
            tool_use_id: 'tool_1',
            content: 'First result',
            is_error: false
          },
          {
            type: 'tool_result' as const,
            tool_use_id: 'tool_2',
            content: 'Second result',
            is_error: false
          }
        ]
      }
    };

    const actions = cliMessageToUIActions(msg);

    expect(actions).toHaveLength(2);
    expect(actions[0]).toEqual({
      type: 'add_tool_result',
      toolUseId: 'tool_1',
      content: 'First result',
      isError: false
    });
    expect(actions[1]).toEqual({
      type: 'add_tool_result',
      toolUseId: 'tool_2',
      content: 'Second result',
      isError: false
    });
  });

  it('handles user message with mixed content (filters non-tool_result)', () => {
    const msg = {
      type: 'user' as const,
      session_id: 'sess_mixed',
      message: {
        role: 'user' as const,
        content: [
          {
            type: 'text' as const,
            text: 'Some user text'
          },
          {
            type: 'tool_result' as const,
            tool_use_id: 'tool_x',
            content: 'Tool output',
            is_error: false
          }
        ]
      }
    };

    const actions = cliMessageToUIActions(msg);

    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({
      type: 'add_tool_result',
      toolUseId: 'tool_x',
      content: 'Tool output',
      isError: false
    });
  });

  // Integration test: simulate a full conversation flow
  it('handles full conversation flow: init -> stream -> assistant -> tool -> result', () => {
    const lines = [
      // 1. Session initialization
      '{"type":"system","subtype":"init","session_id":"sess1","model":"claude-sonnet-4-5-20250929","tools":[{"name":"Read"}]}',

      // 2. Start text block
      '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text"}}}',

      // 3. Streaming text deltas
      '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}}',
      '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":" world"}}}',

      // 4. Complete text block
      '{"type":"stream_event","event":{"type":"content_block_stop","index":0}}',

      // 5. Start tool use block
      '{"type":"stream_event","event":{"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool_read_1","name":"Read"}}}',

      // 6. Stream tool input JSON
      '{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"file"}}}',
      '{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"_path\\":\\""}}}',
      '{"type":"stream_event","event":{"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"/test.txt\\"}"}}}',

      // 7. Complete tool use block
      '{"type":"stream_event","event":{"type":"content_block_stop","index":1}}',

      // 8. Message stop
      '{"type":"stream_event","event":{"type":"message_stop"}}',

      // 9. Finalize assistant turn
      '{"type":"assistant","session_id":"sess1","message":{"id":"msg1","role":"assistant","content":[{"type":"text","text":"Hello world"},{"type":"tool_use","id":"tool_read_1","name":"Read","input":{"file_path":"/test.txt"}}],"model":"claude-sonnet-4-5-20250929","stop_reason":"tool_use","usage":{"input_tokens":100,"output_tokens":50}}}',

      // 10. Tool result from user
      '{"type":"user","session_id":"sess1","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"tool_read_1","content":"File contents here","is_error":false}]}}',

      // 11. Session completion
      '{"type":"result","subtype":"success","session_id":"sess1","is_error":false,"total_cost_usd":0.0025,"total_duration_ms":3000,"num_turns":2}'
    ];

    const allActions: UIAction[] = [];
    for (const line of lines) {
      const msg = parseCLILine(line);
      if (msg) {
        allActions.push(...cliMessageToUIActions(msg));
      }
    }

    // Verify the action sequence
    expect(allActions).toHaveLength(14);

    // 1. Init session
    expect(allActions[0]).toEqual({
      type: 'init_session',
      sessionId: 'sess1',
      model: 'claude-sonnet-4-5-20250929',
      tools: [{ name: 'Read' }]
    });

    // 2. Start text block
    expect(allActions[1]).toEqual({ type: 'start_text_block', index: 0 });

    // 3-4. Append text
    expect(allActions[2]).toEqual({ type: 'append_text', index: 0, text: 'Hello' });
    expect(allActions[3]).toEqual({ type: 'append_text', index: 0, text: ' world' });

    // 5. Complete text block
    expect(allActions[4]).toEqual({ type: 'complete_block', index: 0 });

    // 6. Start tool use block
    expect(allActions[5]).toEqual({
      type: 'start_tool_use_block',
      index: 1,
      toolName: 'Read',
      toolUseId: 'tool_read_1'
    });

    // 7-9. Append tool input JSON chunks
    expect(allActions[6]).toEqual({ type: 'append_tool_input', index: 1, partialJson: '{"file' });
    expect(allActions[7]).toEqual({ type: 'append_tool_input', index: 1, partialJson: '_path":"' });
    expect(allActions[8]).toEqual({ type: 'append_tool_input', index: 1, partialJson: '/test.txt"}' });

    // 10. Complete tool use block
    expect(allActions[9]).toEqual({ type: 'complete_block', index: 1 });

    // 11. Message stop
    expect(allActions[10]).toEqual({ type: 'message_stop' });

    // 12. Finalize assistant turn
    expect(allActions[11]).toMatchObject({
      type: 'finalize_assistant_turn',
      message: {
        type: 'assistant',
        session_id: 'sess1'
      }
    });

    // 13. Add tool result
    expect(allActions[12]).toEqual({
      type: 'add_tool_result',
      toolUseId: 'tool_read_1',
      content: 'File contents here',
      isError: false
    });

    // 14. Session complete
    expect(allActions[13]).toEqual({
      type: 'session_complete',
      sessionId: 'sess1',
      totalCost: 0.0025,
      numTurns: 2,
      durationMs: 3000
    });
  });

  it('handles thinking block in conversation flow', () => {
    const lines = [
      '{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}}',
      '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"I need to"}}}',
      '{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" analyze this"}}}',
      '{"type":"stream_event","event":{"type":"content_block_stop","index":0}}'
    ];

    const allActions: UIAction[] = [];
    for (const line of lines) {
      const msg = parseCLILine(line);
      if (msg) {
        allActions.push(...cliMessageToUIActions(msg));
      }
    }

    expect(allActions).toHaveLength(4);
    expect(allActions[0]).toEqual({ type: 'start_thinking_block', index: 0 });
    expect(allActions[1]).toEqual({ type: 'append_thinking', index: 0, thinking: 'I need to' });
    expect(allActions[2]).toEqual({ type: 'append_thinking', index: 0, thinking: ' analyze this' });
    expect(allActions[3]).toEqual({ type: 'complete_block', index: 0 });
  });

  it('handles tool_use block with missing optional fields gracefully', () => {
    const msg = {
      type: 'stream_event' as const,
      event: {
        type: 'content_block_start' as const,
        index: 0,
        content_block: {
          type: 'tool_use' as const
          // Missing id and name
        }
      }
    };

    const actions = cliMessageToUIActions(msg);

    expect(actions).toEqual([{
      type: 'start_tool_use_block',
      index: 0,
      toolName: 'unknown',
      toolUseId: ''
    }]);
  });
});
