/**
 * useWorkflowEvents Hook
 * Manages SSE connection for workflow run events with auto-reconnect
 */

import { useCallback, useEffect, useState } from 'react';
import { useSSE } from './useSSE';

export interface WorkflowEvent {
  type: string;
  timestamp: string;
  data: Record<string, unknown>;
}

interface UseWorkflowEventsOptions {
  enabled?: boolean;
  onEvent?: (event: WorkflowEvent) => void;
}

export function useWorkflowEvents(
  runId: string | undefined,
  options: UseWorkflowEventsOptions = {},
) {
  const { enabled = true, onEvent } = options;
  const [events, setEvents] = useState<WorkflowEvent[]>([]);
  const [latestEvent, setLatestEvent] = useState<WorkflowEvent | null>(null);

  // Build SSE URL if runId is provided
  const url = runId ? `/api/runs/${runId}/events` : null;

  // Handle incoming messages
  const handleMessage = useCallback(
    (event: MessageEvent) => {
      try {
        const parsedEvent: WorkflowEvent = JSON.parse(event.data);

        setEvents((prev) => [...prev, parsedEvent]);
        setLatestEvent(parsedEvent);

        // Call user callback if provided
        onEvent?.(parsedEvent);
      } catch (error) {
        console.error('[useWorkflowEvents] Failed to parse event:', error);
      }
    },
    [onEvent],
  );

  // Use base SSE hook
  const { isConnected, error, close } = useSSE(url, {
    enabled,
    onMessage: handleMessage,
    onError: (err) => {
      console.error('[useWorkflowEvents] SSE error:', err);
    },
    onOpen: () => {
      console.log('[useWorkflowEvents] Connected to run:', runId);
    },
  });

  // Reset events when runId changes
  useEffect(() => {
    setEvents([]);
    setLatestEvent(null);
  }, [runId]);

  return {
    events,
    latestEvent,
    isConnected,
    error,
    close,
  };
}
