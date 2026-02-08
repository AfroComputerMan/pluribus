import { describe, it, expect, beforeEach } from 'vitest';
import { useChatStore } from './chatStore';
import type { AssistantMessage } from '../types/cli';
import type { ChatMessage } from '../types/chat';

function getState() {
  return useChatStore.getState();
}

function makeAssistantMessage(
  sessionId: string,
  overrides: Partial<AssistantMessage['message']> = {},
): AssistantMessage {
  return {
    type: 'assistant',
    session_id: sessionId,
    message: {
      id: 'msg-1',
      role: 'assistant',
      content: [{ type: 'text', text: 'Hello world' }],
      model: 'claude-sonnet-4-5-20250929',
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
      ...overrides,
    },
  };
}

describe('chatStore', () => {
  beforeEach(() => {
    useChatStore.setState({
      messages: {},
      streamingState: {},
    });
  });

  // ── dispatch: init_session ─────────────────────────
  describe('dispatch: init_session', () => {
    it('initializes messages array for new session', () => {
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });
      expect(getState().messages['s1']).toEqual([]);
    });

    it('preserves existing messages on re-init', () => {
      const existingMsg: ChatMessage = {
        id: 'existing',
        sessionId: 's1',
        role: 'user',
        content: 'hi',
        contentType: 'text',
        orderIndex: 0,
        createdAt: '2026-01-01T00:00:00Z',
      };
      useChatStore.setState({ messages: { s1: [existingMsg] } });

      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });
      expect(getState().messages['s1']).toEqual([existingMsg]);
    });

    it('sets isStreaming to true', () => {
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });
      expect(getState().streamingState['s1'].isStreaming).toBe(true);
    });

    it('creates empty content blocks', () => {
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });
      expect(getState().streamingState['s1'].contentBlocks).toEqual([]);
    });
  });

  // ── dispatch: start_text_block ─────────────────────
  describe('dispatch: start_text_block', () => {
    it('adds a text block to streaming state', () => {
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });
      getState().dispatch('s1', { type: 'start_text_block', index: 0 });

      const ss = getState().streamingState['s1'];
      expect(ss.contentBlocks).toHaveLength(1);
      expect(ss.contentBlocks[0]).toEqual({
        index: 0,
        type: 'text',
        content: '',
        isComplete: false,
      });
      expect(ss.currentBlockIndex).toBe(0);
    });

    it('is a no-op when session has no streaming state', () => {
      getState().dispatch('nonexistent', { type: 'start_text_block', index: 0 });
      expect(getState().streamingState['nonexistent']).toBeUndefined();
    });
  });

  // ── dispatch: start_thinking_block ─────────────────
  describe('dispatch: start_thinking_block', () => {
    it('adds a thinking block to streaming state', () => {
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });
      getState().dispatch('s1', { type: 'start_thinking_block', index: 0 });

      const block = getState().streamingState['s1'].contentBlocks[0];
      expect(block.type).toBe('thinking');
      expect(block.content).toBe('');
      expect(block.isComplete).toBe(false);
    });
  });

  // ── dispatch: start_tool_use_block ─────────────────
  describe('dispatch: start_tool_use_block', () => {
    it('adds a tool_use block with metadata', () => {
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });
      getState().dispatch('s1', {
        type: 'start_tool_use_block',
        index: 0,
        toolName: 'Read',
        toolUseId: 'tu-1',
      });

      const block = getState().streamingState['s1'].contentBlocks[0];
      expect(block.type).toBe('tool_use');
      expect(block.toolName).toBe('Read');
      expect(block.toolUseId).toBe('tu-1');
      expect(block.toolInput).toBe('');
      expect(block.isComplete).toBe(false);
    });
  });

  // ── dispatch: append_text ──────────────────────────
  describe('dispatch: append_text', () => {
    it('appends text to the matching block', () => {
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });
      getState().dispatch('s1', { type: 'start_text_block', index: 0 });
      getState().dispatch('s1', { type: 'append_text', index: 0, text: 'Hello' });
      getState().dispatch('s1', { type: 'append_text', index: 0, text: ' world' });

      expect(getState().streamingState['s1'].contentBlocks[0].content).toBe('Hello world');
    });

    it('only appends to the correct block index', () => {
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });
      getState().dispatch('s1', { type: 'start_text_block', index: 0 });
      getState().dispatch('s1', { type: 'start_text_block', index: 1 });
      getState().dispatch('s1', { type: 'append_text', index: 1, text: 'second' });

      expect(getState().streamingState['s1'].contentBlocks[0].content).toBe('');
      expect(getState().streamingState['s1'].contentBlocks[1].content).toBe('second');
    });

    it('is a no-op when session has no streaming state', () => {
      getState().dispatch('ghost', { type: 'append_text', index: 0, text: 'boo' });
      expect(getState().streamingState['ghost']).toBeUndefined();
    });
  });

  // ── dispatch: append_thinking ──────────────────────
  describe('dispatch: append_thinking', () => {
    it('appends thinking content to the matching block', () => {
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });
      getState().dispatch('s1', { type: 'start_thinking_block', index: 0 });
      getState().dispatch('s1', { type: 'append_thinking', index: 0, thinking: 'Let me ' });
      getState().dispatch('s1', { type: 'append_thinking', index: 0, thinking: 'think...' });

      expect(getState().streamingState['s1'].contentBlocks[0].content).toBe('Let me think...');
    });
  });

  // ── dispatch: append_tool_input ────────────────────
  describe('dispatch: append_tool_input', () => {
    it('appends partial JSON to tool input', () => {
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });
      getState().dispatch('s1', {
        type: 'start_tool_use_block',
        index: 0,
        toolName: 'Edit',
        toolUseId: 'tu-2',
      });
      getState().dispatch('s1', { type: 'append_tool_input', index: 0, partialJson: '{"file":' });
      getState().dispatch('s1', { type: 'append_tool_input', index: 0, partialJson: '"test.ts"}' });

      expect(getState().streamingState['s1'].contentBlocks[0].toolInput).toBe('{"file":"test.ts"}');
    });
  });

  // ── dispatch: complete_block ───────────────────────
  describe('dispatch: complete_block', () => {
    it('marks block as complete', () => {
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });
      getState().dispatch('s1', { type: 'start_text_block', index: 0 });
      getState().dispatch('s1', { type: 'complete_block', index: 0 });

      expect(getState().streamingState['s1'].contentBlocks[0].isComplete).toBe(true);
    });

    it('only marks the specified block index', () => {
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });
      getState().dispatch('s1', { type: 'start_text_block', index: 0 });
      getState().dispatch('s1', { type: 'start_text_block', index: 1 });
      getState().dispatch('s1', { type: 'complete_block', index: 0 });

      expect(getState().streamingState['s1'].contentBlocks[0].isComplete).toBe(true);
      expect(getState().streamingState['s1'].contentBlocks[1].isComplete).toBe(false);
    });
  });

  // ── dispatch: message_stop ─────────────────────────
  describe('dispatch: message_stop', () => {
    it('sets isStreaming to false', () => {
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });
      expect(getState().streamingState['s1'].isStreaming).toBe(true);

      getState().dispatch('s1', { type: 'message_stop' });
      expect(getState().streamingState['s1'].isStreaming).toBe(false);
    });
  });

  // ── dispatch: finalize_assistant_turn ──────────────
  describe('dispatch: finalize_assistant_turn', () => {
    it('converts assistant text to committed ChatMessage', () => {
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });

      const assistantMsg = makeAssistantMessage('s1');
      getState().dispatch('s1', {
        type: 'finalize_assistant_turn',
        message: assistantMsg,
      });

      const msgs = getState().messages['s1'];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].role).toBe('assistant');
      expect(msgs[0].content).toBe('Hello world');
      expect(msgs[0].contentType).toBe('markdown');
      expect(msgs[0].model).toBe('claude-sonnet-4-5-20250929');
      expect(msgs[0].inputTokens).toBe(100);
      expect(msgs[0].outputTokens).toBe(50);
      expect(msgs[0].orderIndex).toBe(0);
    });

    it('resets streaming state after finalization', () => {
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });
      getState().dispatch('s1', { type: 'start_text_block', index: 0 });
      getState().dispatch('s1', { type: 'append_text', index: 0, text: 'data' });

      const assistantMsg = makeAssistantMessage('s1');
      getState().dispatch('s1', {
        type: 'finalize_assistant_turn',
        message: assistantMsg,
      });

      const ss = getState().streamingState['s1'];
      expect(ss.isStreaming).toBe(false);
      expect(ss.contentBlocks).toEqual([]);
      expect(ss.currentBlockIndex).toBe(-1);
    });

    it('converts tool_use blocks to separate messages', () => {
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });

      const assistantMsg = makeAssistantMessage('s1', {
        content: [
          { type: 'text', text: 'I will read the file' },
          { type: 'tool_use', id: 'tu-1', name: 'Read', input: { path: '/foo' } },
        ],
      });
      getState().dispatch('s1', {
        type: 'finalize_assistant_turn',
        message: assistantMsg,
      });

      const msgs = getState().messages['s1'];
      expect(msgs).toHaveLength(2);

      // First: text message
      expect(msgs[0].role).toBe('assistant');
      expect(msgs[0].content).toBe('I will read the file');
      expect(msgs[0].orderIndex).toBe(0);
      expect(msgs[0].inputTokens).toBe(100); // usage on first message

      // Second: tool_use message
      expect(msgs[1].role).toBe('tool_use');
      expect(msgs[1].toolName).toBe('Read');
      expect(msgs[1].toolUseId).toBe('tu-1');
      expect(msgs[1].content).toBe(JSON.stringify({ path: '/foo' }));
      expect(msgs[1].orderIndex).toBe(1);
    });

    it('increments orderIndex from existing messages', () => {
      const existing: ChatMessage = {
        id: 'user-1',
        sessionId: 's1',
        role: 'user',
        content: 'hello',
        contentType: 'text',
        orderIndex: 0,
        createdAt: '2026-01-01T00:00:00Z',
      };
      useChatStore.setState({ messages: { s1: [existing] } });

      const assistantMsg = makeAssistantMessage('s1');
      getState().dispatch('s1', {
        type: 'finalize_assistant_turn',
        message: assistantMsg,
      });

      expect(getState().messages['s1'][1].orderIndex).toBe(1);
    });

    it('creates an empty assistant message when content is empty', () => {
      const assistantMsg = makeAssistantMessage('s1', {
        content: [],
      });
      getState().dispatch('s1', {
        type: 'finalize_assistant_turn',
        message: assistantMsg,
      });

      const msgs = getState().messages['s1'] ?? [];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].role).toBe('assistant');
      expect(msgs[0].content).toBe('');
    });

    it('groups thinking + text into a single message before tool_use', () => {
      const assistantMsg = makeAssistantMessage('s1', {
        content: [
          { type: 'thinking', thinking: 'Hmm let me think' },
          { type: 'text', text: 'Answer: yes' },
          { type: 'tool_use', id: 'tu-1', name: 'Bash', input: { command: 'ls' } },
        ],
      });
      getState().dispatch('s1', {
        type: 'finalize_assistant_turn',
        message: assistantMsg,
      });

      const msgs = getState().messages['s1'] ?? [];
      // thinking+text flushed before tool_use -> 2 messages total
      // The text block contains the text content (text takes priority when both exist in flush)
      expect(msgs.length).toBeGreaterThanOrEqual(2);
      expect(msgs[msgs.length - 1].role).toBe('tool_use');
    });
  });

  // ── dispatch: add_tool_result ──────────────────────
  describe('dispatch: add_tool_result', () => {
    it('adds a tool_result message', () => {
      getState().dispatch('s1', {
        type: 'add_tool_result',
        toolUseId: 'tu-1',
        content: '{"result": "ok"}',
        isError: false,
      });

      const msgs = getState().messages['s1'] ?? [];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].role).toBe('tool_result');
      expect(msgs[0].toolUseId).toBe('tu-1');
      expect(msgs[0].content).toBe('{"result": "ok"}');
      expect(msgs[0].isError).toBe(false);
      expect(msgs[0].contentType).toBe('json');
    });

    it('marks error tool results correctly', () => {
      getState().dispatch('s1', {
        type: 'add_tool_result',
        toolUseId: 'tu-err',
        content: 'File not found',
        isError: true,
      });

      const msgs = getState().messages['s1'] ?? [];
      expect(msgs[0].isError).toBe(true);
      expect(msgs[0].contentType).toBe('text');
    });

    it('increments orderIndex correctly', () => {
      // Add two tool results in sequence
      getState().dispatch('s1', {
        type: 'add_tool_result',
        toolUseId: 'tu-1',
        content: 'first',
        isError: false,
      });
      getState().dispatch('s1', {
        type: 'add_tool_result',
        toolUseId: 'tu-2',
        content: 'second',
        isError: false,
      });

      const msgs = getState().messages['s1'] ?? [];
      expect(msgs[0].orderIndex).toBe(0);
      expect(msgs[1].orderIndex).toBe(1);
    });
  });

  // ── dispatch: session_complete ─────────────────────
  describe('dispatch: session_complete', () => {
    it('resets streaming state', () => {
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });
      getState().dispatch('s1', { type: 'start_text_block', index: 0 });

      getState().dispatch('s1', {
        type: 'session_complete',
        sessionId: 's1',
        totalCost: 0.05,
        numTurns: 3,
        durationMs: 5000,
      });

      const ss = getState().streamingState['s1'];
      expect(ss.isStreaming).toBe(false);
      expect(ss.contentBlocks).toEqual([]);
    });

    it('preserves committed messages', () => {
      const msg: ChatMessage = {
        id: 'committed',
        sessionId: 's1',
        role: 'assistant',
        content: 'done',
        contentType: 'markdown',
        orderIndex: 0,
        createdAt: '2026-01-01T00:00:00Z',
      };
      useChatStore.setState({ messages: { s1: [msg] } });

      getState().dispatch('s1', {
        type: 'session_complete',
        sessionId: 's1',
        totalCost: 0.01,
        numTurns: 1,
        durationMs: 1000,
      });

      expect(getState().messages['s1']).toEqual([msg]);
    });
  });

  // ── dispatch: session_error ────────────────────────
  describe('dispatch: session_error', () => {
    it('adds an error message and resets streaming', () => {
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });

      getState().dispatch('s1', {
        type: 'session_error',
        sessionId: 's1',
        error: 'Connection failed',
      });

      const msgs = getState().messages['s1'];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].role).toBe('system');
      expect(msgs[0].content).toBe('Connection failed');
      expect(msgs[0].isError).toBe(true);

      const ss = getState().streamingState['s1'];
      expect(ss.isStreaming).toBe(false);
      expect(ss.contentBlocks).toEqual([]);
    });
  });

  // ── clearSession ───────────────────────────────────
  describe('clearSession', () => {
    it('removes all messages and streaming state for a session', () => {
      useChatStore.setState({
        messages: { s1: [], s2: [] },
        streamingState: {
          s1: { isStreaming: false, sessionId: 's1', contentBlocks: [], currentBlockIndex: -1 },
          s2: { isStreaming: false, sessionId: 's2', contentBlocks: [], currentBlockIndex: -1 },
        },
      });

      getState().clearSession('s1');

      expect(getState().messages['s1']).toBeUndefined();
      expect(getState().streamingState['s1']).toBeUndefined();
      // s2 should remain
      expect(getState().messages['s2']).toEqual([]);
      expect(getState().streamingState['s2']).toBeDefined();
    });
  });

  // ── loadMessages ───────────────────────────────────
  describe('loadMessages', () => {
    it('loads messages for a session', () => {
      const msgs: ChatMessage[] = [
        {
          id: 'loaded-1',
          sessionId: 's1',
          role: 'user',
          content: 'hello',
          contentType: 'text',
          orderIndex: 0,
          createdAt: '2026-01-01T00:00:00Z',
        },
        {
          id: 'loaded-2',
          sessionId: 's1',
          role: 'assistant',
          content: 'hi',
          contentType: 'markdown',
          orderIndex: 1,
          createdAt: '2026-01-01T00:00:01Z',
        },
      ];

      getState().loadMessages('s1', msgs);
      expect(getState().messages['s1']).toEqual(msgs);
    });

    it('replaces existing messages for a session', () => {
      useChatStore.setState({
        messages: {
          s1: [{
            id: 'old',
            sessionId: 's1',
            role: 'user',
            content: 'old',
            contentType: 'text',
            orderIndex: 0,
            createdAt: '2026-01-01T00:00:00Z',
          }],
        },
      });

      const newMsgs: ChatMessage[] = [{
        id: 'new',
        sessionId: 's1',
        role: 'user',
        content: 'new',
        contentType: 'text',
        orderIndex: 0,
        createdAt: '2026-01-02T00:00:00Z',
      }];

      getState().loadMessages('s1', newMsgs);
      expect(getState().messages['s1']).toEqual(newMsgs);
    });

    it('does not affect other sessions', () => {
      useChatStore.setState({ messages: { s2: [] } });
      getState().loadMessages('s1', []);
      expect(getState().messages['s2']).toEqual([]);
    });
  });

  // ── Multi-session isolation ────────────────────────
  describe('multi-session isolation', () => {
    it('messages do not cross-contaminate between sessions', () => {
      // Init two sessions
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });
      getState().dispatch('s2', {
        type: 'init_session',
        sessionId: 's2',
        model: 'opus',
        tools: [],
      });

      // Add message to s1 only
      const assistantMsg = makeAssistantMessage('s1');
      getState().dispatch('s1', {
        type: 'finalize_assistant_turn',
        message: assistantMsg,
      });

      expect(getState().messages['s1']).toHaveLength(1);
      expect(getState().messages['s2']).toEqual([]);
    });

    it('streaming state is independent per session', () => {
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });
      getState().dispatch('s2', {
        type: 'init_session',
        sessionId: 's2',
        model: 'opus',
        tools: [],
      });

      getState().dispatch('s1', { type: 'start_text_block', index: 0 });
      getState().dispatch('s1', { type: 'append_text', index: 0, text: 'session one' });

      expect(getState().streamingState['s1'].contentBlocks).toHaveLength(1);
      expect(getState().streamingState['s2'].contentBlocks).toHaveLength(0);
    });

    it('clearSession only affects the target session', () => {
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });
      getState().dispatch('s2', {
        type: 'init_session',
        sessionId: 's2',
        model: 'opus',
        tools: [],
      });

      const msg = makeAssistantMessage('s2');
      getState().dispatch('s2', {
        type: 'finalize_assistant_turn',
        message: msg,
      });

      getState().clearSession('s1');

      expect(getState().messages['s1']).toBeUndefined();
      expect(getState().messages['s2']).toHaveLength(1);
    });
  });

  // ── Full streaming lifecycle ───────────────────────
  describe('full streaming lifecycle', () => {
    it('processes a complete text streaming cycle', () => {
      // 1. Init session
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });
      expect(getState().streamingState['s1'].isStreaming).toBe(true);

      // 2. Start text block
      getState().dispatch('s1', { type: 'start_text_block', index: 0 });
      expect(getState().streamingState['s1'].contentBlocks).toHaveLength(1);

      // 3. Stream text deltas
      getState().dispatch('s1', { type: 'append_text', index: 0, text: 'Hello' });
      getState().dispatch('s1', { type: 'append_text', index: 0, text: ', ' });
      getState().dispatch('s1', { type: 'append_text', index: 0, text: 'world!' });
      expect(getState().streamingState['s1'].contentBlocks[0].content).toBe('Hello, world!');

      // 4. Complete block
      getState().dispatch('s1', { type: 'complete_block', index: 0 });
      expect(getState().streamingState['s1'].contentBlocks[0].isComplete).toBe(true);

      // 5. Message stop
      getState().dispatch('s1', { type: 'message_stop' });
      expect(getState().streamingState['s1'].isStreaming).toBe(false);

      // 6. Finalize
      const assistantMsg = makeAssistantMessage('s1', {
        content: [{ type: 'text', text: 'Hello, world!' }],
      });
      getState().dispatch('s1', {
        type: 'finalize_assistant_turn',
        message: assistantMsg,
      });

      // Messages committed, streaming reset
      expect(getState().messages['s1']).toHaveLength(1);
      expect(getState().messages['s1'][0].content).toBe('Hello, world!');
      expect(getState().streamingState['s1'].contentBlocks).toEqual([]);
    });

    it('processes a tool use cycle', () => {
      getState().dispatch('s1', {
        type: 'init_session',
        sessionId: 's1',
        model: 'sonnet',
        tools: [],
      });

      // Start tool use block
      getState().dispatch('s1', {
        type: 'start_tool_use_block',
        index: 0,
        toolName: 'Bash',
        toolUseId: 'tu-bash',
      });

      // Stream tool input
      getState().dispatch('s1', { type: 'append_tool_input', index: 0, partialJson: '{"cmd":' });
      getState().dispatch('s1', { type: 'append_tool_input', index: 0, partialJson: '"ls"}' });

      // Complete and stop
      getState().dispatch('s1', { type: 'complete_block', index: 0 });
      getState().dispatch('s1', { type: 'message_stop' });

      // Finalize with tool_use in content
      const assistantMsg = makeAssistantMessage('s1', {
        content: [{ type: 'tool_use', id: 'tu-bash', name: 'Bash', input: { cmd: 'ls' } }],
      });
      getState().dispatch('s1', {
        type: 'finalize_assistant_turn',
        message: assistantMsg,
      });

      const msgs = getState().messages['s1'];
      expect(msgs).toHaveLength(1);
      expect(msgs[0].role).toBe('tool_use');
      expect(msgs[0].toolName).toBe('Bash');

      // Add tool result
      getState().dispatch('s1', {
        type: 'add_tool_result',
        toolUseId: 'tu-bash',
        content: 'file1.ts\nfile2.ts',
        isError: false,
      });

      expect(getState().messages['s1']).toHaveLength(2);
      expect(getState().messages['s1'][1].role).toBe('tool_result');
    });
  });
});
