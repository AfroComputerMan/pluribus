import { useCallback } from 'react';
import { useSessionStore } from '@/stores/sessionStore';

export function useCostTracking() {
  const sessions = useSessionStore((s) => s.sessions);

  const getSessionCost = useCallback((sessionId: string): number => {
    const session = sessions.find((s) => s.id === sessionId);
    return session?.totalCostUsd ?? 0;
  }, [sessions]);

  const totalCost = sessions.reduce((sum, s) => sum + s.totalCostUsd, 0);

  return { getSessionCost, totalCost };
}
