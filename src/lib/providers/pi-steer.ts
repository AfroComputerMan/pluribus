/**
 * Pi real-time control side-channel (#20): steer + authoritative run-state +
 * transient steer/queue notices.
 *
 * Steer is OUT-OF-BAND: assistant-ui has no mid-turn message-injection API, so
 * the steer text is sent straight to Rust (`pi_steer_agent` -> pi stdin) rather
 * than through the `run()` generator. It is QUEUED — Pi applies it at the next
 * turn/tool boundary in its default one-at-a-time mode, NOT a mid-token
 * interrupt. The UI copy must reflect that.
 *
 * Steer produces no echoed thread message (unlike `prompt`), so its only UI
 * visibility is a TRANSIENT annotation (decision A in the plan) — never a
 * persisted message. The provider's `pi:event` loop pushes a "queued" notice
 * here when a `queue_update` event arrives; the SteerControl shows a local
 * "steered — applies at the next step" annotation on submit.
 */
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

// ---------------------------------------------------------------------------
// Steer command (out-of-band invoke)
// ---------------------------------------------------------------------------

/**
 * Queue mid-run guidance for the agent running in `threadId`'s session.
 *
 * The message is serialized Rust-side by `serde_json` (via the command param),
 * so newlines are escaped and pi's LF JSONL framing stays intact — do NOT
 * hand-build the `{type:"steer",message}` JSON here.
 */
export async function steerPiAgent(
  threadId: string,
  message: string,
): Promise<void> {
  // session_id == threadId for the Pi POC (1:1 mapping).
  await invoke("pi_steer_agent", { sessionId: threadId, message });
}

// ---------------------------------------------------------------------------
// Authoritative agent-running probe
// ---------------------------------------------------------------------------

/**
 * Read the Rust-authoritative mid-turn flag for a session. `agent_running` is
 * true only between `agent_start`/`turn_start` and `agent_end`/exit, flipped in
 * the Rust reader (NOT derived from assistant-ui's `thread.isRunning`). Used to
 * gate the steer + abort controls. Returns false if the session is gone.
 *
 * Uses the probe-free `pi_agent_running` command: it reads the Rust AtomicBool
 * directly and, unlike `pi_get_state`, does NOT push a `get_state` line into
 * pi's stdin — so the ~1/s poll adds no recurring mid-run stdin traffic (#20).
 */
export async function getPiAgentRunning(threadId: string): Promise<boolean> {
  try {
    return await invoke<boolean>("pi_agent_running", { sessionId: threadId });
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Transient steer/queue notices (NOT persisted messages)
// ---------------------------------------------------------------------------

export type SteerNoticeKind = "steered" | "queued";

export interface SteerNotice {
  /** Monotonic id so a repeat notice re-triggers the auto-dismiss timer. */
  id: number;
  threadId: string;
  kind: SteerNoticeKind;
}

interface PiSteerStore {
  /** At most one active notice per thread (latest wins). */
  noticeByThread: Record<string, SteerNotice>;
  /** Surface a transient notice for a thread (caller schedules dismissal). */
  pushNotice: (threadId: string, kind: SteerNoticeKind) => void;
  /** Clear a thread's notice if `id` still matches (no stale dismissals). */
  dismissNotice: (threadId: string, id: number) => void;
}

let noticeSeq = 0;

export const usePiSteerStore = create<PiSteerStore>((set) => ({
  noticeByThread: {},
  pushNotice: (threadId, kind) =>
    set((state) => ({
      noticeByThread: {
        ...state.noticeByThread,
        [threadId]: { id: ++noticeSeq, threadId, kind },
      },
    })),
  dismissNotice: (threadId, id) =>
    set((state) => {
      const current = state.noticeByThread[threadId];
      if (!current || current.id !== id) return state;
      const next = { ...state.noticeByThread };
      delete next[threadId];
      return { noticeByThread: next };
    }),
}));

/**
 * Non-hook accessor so non-React code (the provider's `pi:event` loop) can push
 * a transient "steer queued" notice when a `queue_update` event arrives.
 */
export function pushPiSteerNotice(
  threadId: string,
  kind: SteerNoticeKind,
): void {
  usePiSteerStore.getState().pushNotice(threadId, kind);
}
