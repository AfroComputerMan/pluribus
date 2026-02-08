import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatPanel } from './ChatPanel';
import type { ChatMessage, StreamingState } from '@/types/chat';

// Mock the chatStore
const mockMessages: Record<string, ChatMessage[]> = {};
const mockStreamingState: Record<string, StreamingState> = {};

vi.mock('@/stores/chatStore', () => ({
  useChatStore: (selector: (state: any) => any) =>
    selector({
      messages: mockMessages,
      streamingState: mockStreamingState,
    }),
}));

// Mock child components to isolate ChatPanel logic
vi.mock('./StreamingMessage', () => ({
  StreamingMessage: ({ streamingState }: { streamingState: StreamingState }) => (
    <div data-testid="streaming-message">Streaming: {streamingState.isStreaming ? 'yes' : 'no'}</div>
  ),
}));

vi.mock('./ChatInput', () => ({
  ChatInput: ({ onSend, disabled, isStreaming }: any) => (
    <div data-testid="chat-input">
      <button
        onClick={() => onSend?.('test message')}
        disabled={disabled}
        data-streaming={isStreaming}
      >
        MockSend
      </button>
    </div>
  ),
}));

vi.mock('./MessageBubble', () => ({
  MessageBubble: ({ message }: { message: ChatMessage }) => (
    <div data-testid={`message-${message.id}`}>{message.content}</div>
  ),
}));

function makeMessage(id: string, content: string, role: ChatMessage['role'] = 'user'): ChatMessage {
  return {
    id,
    sessionId: 's1',
    role,
    content,
    contentType: 'text',
    orderIndex: 0,
    createdAt: '2026-02-08T12:00:00Z',
  };
}

describe('ChatPanel', () => {
  beforeEach(() => {
    // Reset mock state
    for (const key of Object.keys(mockMessages)) delete mockMessages[key];
    for (const key of Object.keys(mockStreamingState)) delete mockStreamingState[key];
  });

  test('shows "Select or create a session" when no sessionId', () => {
    render(<ChatPanel />);
    expect(screen.getByText('Select or create a session')).toBeInTheDocument();
  });

  test('renders empty state for session with no messages', () => {
    mockMessages['s1'] = [];
    render(<ChatPanel sessionId="s1" />);
    // ChatInput should be present even with no messages
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
    // No message bubbles
    expect(screen.queryByTestId(/^message-/)).not.toBeInTheDocument();
  });

  test('renders message list from chatStore', () => {
    mockMessages['s1'] = [
      makeMessage('m1', 'Hello'),
      makeMessage('m2', 'World', 'assistant'),
    ];
    render(<ChatPanel sessionId="s1" />);

    expect(screen.getByTestId('message-m1')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
    expect(screen.getByTestId('message-m2')).toBeInTheDocument();
    expect(screen.getByText('World')).toBeInTheDocument();
  });

  test('renders ChatInput component', () => {
    mockMessages['s1'] = [];
    render(<ChatPanel sessionId="s1" />);
    expect(screen.getByTestId('chat-input')).toBeInTheDocument();
  });

  test('shows streaming message when streamingState exists', () => {
    mockMessages['s1'] = [];
    mockStreamingState['s1'] = {
      isStreaming: true,
      sessionId: 's1',
      contentBlocks: [],
      currentBlockIndex: -1,
    };
    render(<ChatPanel sessionId="s1" />);

    expect(screen.getByTestId('streaming-message')).toBeInTheDocument();
    expect(screen.getByText(/Streaming: yes/)).toBeInTheDocument();
  });

  test('does not show streaming message when no streaming state', () => {
    mockMessages['s1'] = [];
    render(<ChatPanel sessionId="s1" />);
    expect(screen.queryByTestId('streaming-message')).not.toBeInTheDocument();
  });

  test('calls onSendMessage when ChatInput sends', async () => {
    mockMessages['s1'] = [];
    const onSend = vi.fn();
    render(<ChatPanel sessionId="s1" onSendMessage={onSend} />);

    const sendButton = screen.getByText('MockSend');
    sendButton.click();
    expect(onSend).toHaveBeenCalledWith('test message');
  });

  test('scroll container ref is rendered', () => {
    mockMessages['s1'] = [makeMessage('m1', 'Content')];
    const { container } = render(<ChatPanel sessionId="s1" />);
    // The scroll container is the flex-1 overflow-y-auto div
    const scrollDiv = container.querySelector('.overflow-y-auto');
    expect(scrollDiv).not.toBeNull();
  });
});
