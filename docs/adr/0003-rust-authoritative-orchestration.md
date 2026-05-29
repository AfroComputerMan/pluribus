# Orchestration state is Rust-authoritative; the frontend is a view

**Status:** accepted (2026-05-29)

## Context & Decision

Agents run as Pi processes inside Docker sandboxes, managed by the Rust backend (bollard + git + stdio pump). The existing TypeScript orchestration layer (`src/lib/orchestration/`) was built for the old model where the **frontend** owned agent lifecycle via in-memory Tauri-shell `Child` handles. We **invert this**: the Rust backend becomes the single source of truth for which agents exist and their status (persisted in SQLite, with container orphan-recovery on startup); the frontend **rehydrates from Rust and acts as a view/controller.**

## Why

- Agent **`Child`/PID handles are webview-lifetime-scoped**, but containers (and `PROJECT.md`'s fire-and-forget agents) outlive the webview. The source of truth must live in the process that outlives a window reload — the Rust backend.
- Phase 1 removed the Tauri **shell plugin** (security); container lifecycle is Rust-only via **bollard** anyway. The TS process-manager's responsibility has no host to act on.
- Crash/orphan recovery becomes "list and kill stale containers" — a Rust/bollard operation, not a TS PID operation.

## What moves vs. stays

- **Moves to Rust:** container/clone/pi lifecycle, the agents table + crash recovery (replaces `agent-process-manager.ts`'s `Child`/PID model). Reuses the `codex/service.rs` stdio-streaming pattern.
- **Stays TS (re-pointed at Rust events):** `orchestrated-adapter.ts` (the assistant-ui seam — must be TS), the collapsed single `pi-provider.ts` (invoke/listen client), `agent-status-store.ts` (UI state, rehydrated from Rust), and concurrency/coordination policy as a view-side hint.

## Consequences

- The frontend must rehydrate agent state from Rust on every load (no in-memory authority).
- `concurrency-governor.ts`'s limit is now advisory UI policy unless also enforced in Rust; decide enforcement location when implementing.
