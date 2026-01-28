/**
 * useSSE Hook
 * Manages Server-Sent Events connection for real-time updates
 */

import { useEffect, useRef, useState } from 'react';

interface SSEOptions {
  onMessage?: (event: MessageEvent) => void;
  onError?: (error: Event) => void;
  onOpen?: (event: Event) => void;
  enabled?: boolean;
}

export function useSSE(url: string | null, options: SSEOptions = {}) {
  const { onMessage, onError, onOpen, enabled = true } = options;
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // Don't connect if disabled or no URL
    if (!enabled || !url) {
      return;
    }

    // Create EventSource connection
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    eventSource.onopen = (event) => {
      console.log('[SSE] Connection opened', url);
      setIsConnected(true);
      setError(null);
      onOpen?.(event);
    };

    eventSource.onmessage = (event) => {
      console.log('[SSE] Message received', event.data);
      onMessage?.(event);
    };

    eventSource.onerror = (event) => {
      console.error('[SSE] Connection error', event);
      setIsConnected(false);
      setError(new Error('SSE connection error'));
      onError?.(event);
    };

    // Cleanup on unmount
    return () => {
      console.log('[SSE] Closing connection', url);
      eventSource.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    };
  }, [url, enabled, onMessage, onError, onOpen]);

  return {
    isConnected,
    error,
    close: () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
      setIsConnected(false);
    },
  };
}
