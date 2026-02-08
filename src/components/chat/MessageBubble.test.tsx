import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageBubble } from './MessageBubble';
import type { ChatMessage } from '@/types/chat';

function makeMessage(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: 'msg-1',
    sessionId: 's1',
    role: 'user',
    content: 'Hello world',
    contentType: 'text',
    orderIndex: 0,
    createdAt: '2026-02-08T12:00:00Z',
    ...overrides,
  };
}

describe('MessageBubble', () => {
  test('renders user message text', () => {
    render(<MessageBubble message={makeMessage({ role: 'user', content: 'Hi there' })} />);
    expect(screen.getByText('Hi there')).toBeInTheDocument();
  });

  test('user message has right-aligned layout', () => {
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'user' })} />,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('justify-end');
  });

  test('assistant message has left-aligned layout', () => {
    const { container } = render(
      <MessageBubble message={makeMessage({ role: 'assistant', content: 'Sure!' })} />,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('justify-start');
  });

  test('renders assistant markdown content', () => {
    render(
      <MessageBubble
        message={makeMessage({ role: 'assistant', content: '**bold text**' })}
      />,
    );
    const bold = screen.getByText('bold text');
    expect(bold.tagName).toBe('STRONG');
  });

  test('renders system message with italic styling', () => {
    const { container } = render(
      <MessageBubble
        message={makeMessage({ role: 'system', content: 'System notice' })}
      />,
    );
    expect(screen.getByText('System notice')).toBeInTheDocument();
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('justify-center');
  });

  test('renders tool_use message as ToolCallCard', () => {
    render(
      <MessageBubble
        message={makeMessage({
          role: 'tool_use',
          toolName: 'Read',
          content: '{"file_path": "/tmp/test.ts"}',
        })}
      />,
    );
    expect(screen.getByText('Read')).toBeInTheDocument();
  });

  test('renders tool_result message as ToolResultCard', () => {
    render(
      <MessageBubble
        message={makeMessage({
          role: 'tool_result',
          content: 'File contents here',
          toolName: 'Read',
        })}
      />,
    );
    expect(screen.getByText(/Result/)).toBeInTheDocument();
  });

  test('displays formatted timestamp', () => {
    render(<MessageBubble message={makeMessage()} />);
    // The timestamp is formatted via toLocaleTimeString; just check it appears
    const timeElements = screen.getAllByText(/\d{1,2}:\d{2}/);
    expect(timeElements.length).toBeGreaterThan(0);
  });

  test('handles missing optional fields gracefully', () => {
    const msg = makeMessage({
      role: 'assistant',
      content: 'No extras',
      model: undefined,
      inputTokens: undefined,
      outputTokens: undefined,
      costUsd: undefined,
    });
    render(<MessageBubble message={msg} />);
    expect(screen.getByText('No extras')).toBeInTheDocument();
  });
});
