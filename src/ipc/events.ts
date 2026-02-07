import { listen, type UnlistenFn } from '@tauri-apps/api/event';

// ── Event Payloads ─────────────────────────────────

export interface SessionStatusChangedPayload {
  sessionId: string;
  status: 'created' | 'running' | 'completed' | 'failed' | 'killed' | 'paused';
  exitCode?: number;
}

export interface PermissionRequestPayload {
  requestId: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
}

export interface ProcessErrorPayload {
  sessionId: string;
  error: string;
}

// ── Event Listeners ────────────────────────────────

export function onSessionStatusChanged(
  callback: (payload: SessionStatusChangedPayload) => void,
): Promise<UnlistenFn> {
  return listen<SessionStatusChangedPayload>('session-status-changed', (event) => {
    callback(event.payload);
  });
}

export function onPermissionRequest(
  callback: (payload: PermissionRequestPayload) => void,
): Promise<UnlistenFn> {
  return listen<PermissionRequestPayload>('permission-request', (event) => {
    callback(event.payload);
  });
}

export function onProcessError(
  callback: (payload: ProcessErrorPayload) => void,
): Promise<UnlistenFn> {
  return listen<ProcessErrorPayload>('process-error', (event) => {
    callback(event.payload);
  });
}
