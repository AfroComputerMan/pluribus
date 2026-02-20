# Concurrent Thread Status & Multitasking Design

**Date:** 2026-02-20
**Status:** Approved

## Overview

Enable users to run multiple Claude threads simultaneously, switch between them freely while they're processing, and see real-time status indicators for each thread in the sidebar.

## Goals

- Visual indicators per thread in the sidebar: running, waiting for approval, error, unread
- Toast notifications when a background thread finishes, errors, or needs approval
- Unread badge on threads that completed while the user was elsewhere
- Approval state detection for Codex and Agent SDK adapters

## Current State

The backend concurrency model is already correct: `activeThreadRuns` in `claude-adapter.ts` is a `Set<string>` keyed by `threadKey`, so multiple threads genuinely run in parallel today. The only gap is that this runtime state is not observable from the React component tree — there are no UI indicators of per-thread status.

## Thread Status Model

Four states tracked per `threadId` in a Zustand store:

```ts
type ThreadStatus = 'idle' | 'running' | 'waiting-approval' | 'error'

type ThreadStatusRecord = {
  status: ThreadStatus
  unread: boolean
  finishedAt?: number
}

type ThreadStatusStore = {
  statuses: Map<string, ThreadStatusRecord>
  setStatus: (threadId: string, status: ThreadStatus) => void
  markRead: (threadId: string) => void
}
```

**State transitions per adapter run:**

| Trigger | Status change |
|---|---|
| Run starts | `running` |
| Approval event received | `waiting-approval` |
| Approval dismissed/resolved | `running` |
| Run completes normally | `idle`, `unread=true` if user on another thread |
| Run throws error | `error`, `unread=true` if user on another thread |
| User navigates to thread | `markRead()` → `unread=false` |

## Architecture

### New File: `src/lib/thread-status-store.ts`

Zustand store (using existing `zustand` dependency) exposing:
- `statuses: Map<string, ThreadStatusRecord>` — per-thread status
- `setStatus(threadId, status)` — called by adapters
- `markRead(threadId)` — called when user visits a thread
- `getCurrentThreadId()` — used inside `setStatus` to determine whether to set `unread=true`

### Adapter Integration Points

**`src/lib/router-adapter.ts`** (wraps all three adapters)
Wrap the `run()` generator with try/finally:
```
run start     → setStatus(threadId, 'running')
run completes → setStatus(threadId, 'idle')
run throws    → setStatus(threadId, 'error')
```
This single wrap covers Claude (shell), Agent SDK, and Codex uniformly for running/idle/error states.

**`src/lib/codex-adapter.ts`** — approval detection
After pushing to `useCodexApprovalStore`, also call `setStatus(threadId, 'waiting-approval')`.
When the approval store item is dismissed via `codex_approve_tool`, revert to `running`.

**`src/lib/agent-sdk-adapter.ts`** — approval detection
Implement the `ClaudePermissionRequest` stubs in `claude-adapter.ts`.
When the sidecar emits a permission-request event, push to the status store as `waiting-approval`.
When the user responds via `respondToClaudePermissionRequest`, revert to `running`.

**Shell adapter (Claude CLI):** Approval detection deferred — not in scope for this feature.

### Thread List UI: `src/components/assistant-ui/thread-list.tsx`

Each thread row subscribes to `useThreadStatusStore` (via `useShallow` selector for its specific thread ID). Renders a status icon at the right edge of the row (replacing or sitting beside the hover-action buttons when active):

| Status | Icon | Style |
|---|---|---|
| `running` | Animated spinner (`Loader2` from lucide) | muted-foreground, animate-spin |
| `waiting-approval` | Warning triangle (`AlertTriangle`) | amber/yellow, subtle pulse |
| `error` | X circle (`XCircle`) | destructive red |
| `idle` + `unread=true` | Filled dot | blue/primary |
| `idle` + `unread=false` | Nothing | — |

Icons appear at consistent 14px size in the right slot of the thread row. They do not interfere with hover action buttons (shown on hover, status icons shown at rest).

### Toast Notifications

Uses shadcn `<Sonner />` (toast system). A subscriber hook `useThreadStatusToasts` listens to the Zustand store via `subscribe()` and fires toasts on transitions from any background thread:

| Transition | Toast variant | Duration | Action button |
|---|---|---|---|
| `running` → `idle` (background thread) | Default | 4s auto-dismiss | "View" → switch to thread |
| `running` → `error` (background thread) | Destructive | Manual dismiss | "View" → switch to thread |
| `running` → `waiting-approval` (background thread) | Warning | Manual dismiss | "Go" → switch to thread |

"Background thread" = the transition happened while the user is viewing a different thread.

The hook is mounted once in `RuntimeProvider` or `ThreadWorkspace`.

### Unread Badge

The `unread` flag on `ThreadStatusRecord` drives a small dot badge on the thread row (separate from the status icon). Cleared immediately via `markRead()` when the user navigates to that thread — wired into the thread switching logic in `thread-list.tsx`.

## Files to Create or Modify

| File | Change |
|---|---|
| `src/lib/thread-status-store.ts` | **New** — Zustand store |
| `src/lib/router-adapter.ts` | Wrap `run()` with status transitions |
| `src/lib/codex-adapter.ts` | Set `waiting-approval` on approval events |
| `src/lib/agent-sdk-adapter.ts` | Implement approval stubs, set `waiting-approval` |
| `src/lib/claude-adapter.ts` | Expose `getCurrentThreadId` helper or integrate |
| `src/components/assistant-ui/thread-list.tsx` | Add status icons + unread badge to thread rows |
| `src/components/RuntimeProvider.tsx` or `ThreadWorkspace.tsx` | Mount `useThreadStatusToasts` hook |

## Out of Scope

- Shell adapter approval detection (deferred)
- Inline approve/deny from sidebar (must switch to thread)
- Auto-switch to completed thread
- Queued state indicator (user opted out)
