import { Command } from '@tauri-apps/plugin-shell';
import { useState, useCallback, useRef } from 'react';

interface ClaudeEvent {
  type: string;
  subtype?: string;
  message?: { content: Array<{ type: string; text?: string }> };
  result?: string;
  cost_usd?: number;
  session_id?: string;
  delta?: { type: string; text: string };
}

export function useClaude() {
  const [messages, setMessages] = useState<Array<{role: string; content: string}>>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentResponse, setCurrentResponse] = useState('');
  const childRef = useRef<any>(null);
  const sessionIdRef = useRef<string | null>(null);

  const sendMessage = useCallback(async (prompt: string) => {
    setIsStreaming(true);
    setCurrentResponse('');
    setMessages(prev => [...prev, { role: 'user', content: prompt }]);

    const args = ['-p', prompt, '--output-format', 'stream-json'];
    if (sessionIdRef.current) {
      args.push('--resume', sessionIdRef.current);
    }

    const command = Command.create('claude', args);
    let fullResponse = '';

    command.stdout.on('data', (line: string) => {
      if (!line.trim()) return;
      try {
        const event: ClaudeEvent = JSON.parse(line);
        if (event.type === 'system') {
          sessionIdRef.current = event.session_id ?? null;
        } else if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              fullResponse = block.text;
              setCurrentResponse(fullResponse);
            }
          }
        } else if (event.type === 'result' && event.result) {
          setMessages(prev => [...prev, { role: 'assistant', content: event.result! }]);
          setCurrentResponse('');
        }
      } catch (e) { /* skip unparseable lines */ }
    });

    command.on('close', () => setIsStreaming(false));
    command.on('error', () => setIsStreaming(false));

    childRef.current = await command.spawn();
  }, []);

  const cancel = useCallback(async () => {
    if (childRef.current) {
      await childRef.current.kill();
      setIsStreaming(false);
    }
  }, []);

  return { messages, currentResponse, isStreaming, sendMessage, cancel };
}