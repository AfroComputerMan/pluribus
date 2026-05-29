# Orchestration state is Rust-authoritative; the frontend is a view

**Status:** accepted (2026-05-29)

## Context & Decision

Agents run as Pi processes inside Docker sandboxes, managed by the Rust backend (bollard + git + stdio pump). The existing TypeScript orchestration layer (`src/lib/orchestration/`) was built for the old model where the **frontend** owned agent lifecycle via in-memory Tauri-shell `Child` handles. We **invert this**: the Rust backend becomes the single source of truth for which agents exist and their status (persisted in SQLite, with container orphan-recovery on startup); the frontend **rehydrates from Rust and acts as a view/controller.**

## Why

- Agent **`Child`/PID handles are webview-lifetime-scoped**, but containers (and `PROJECT.md`'s fire-and-forget agents) outlive the webview. The source of truth must live in the process that outlives a window reload — the Rust backend.
- Container lifecycle is Rust-only via **bollard**, and Pi is spawned directly by Rust (host) or via `docker exec` (sandbox), so the Tauri **shell plugin** is not needed for Pi. (Correction: the shell plugin has **not** been removed yet — `tauri-plugin-shell` is still in `Cargo.toml`, initialized in `lib.rs`, and granted in `capabilities/default.json` because the legacy codex/agent-sdk engines still use it. It is **slated for removal** in the same cleanup pass that deletes those engines, once Pi supersedes them — see [CONTEXT.md](../../CONTEXT.md).) Either way, the TS process-manager's responsibility has no host to act on.
- Crash/orphan recovery becomes "list and kill stale containers" — a Rust/bollard operation, not a TS PID operation.

## What moves vs. stays

- **Moves to Rust:** container/clone/pi lifecycle, the agents table + crash recovery (replaces `agent-process-manager.ts`'s `Child`/PID model). Reuses the `codex/service.rs` stdio-streaming pattern.
- **Stays TS (re-pointed at Rust events):** `orchestrated-adapter.ts` (the assistant-ui seam — must be TS), the collapsed single `pi-provider.ts` (invoke/listen client), `agent-status-store.ts` (UI state, rehydrated from Rust), and concurrency/coordination policy as a view-side hint.

## Consequences

- The frontend must rehydrate agent state from Rust on every load (no in-memory authority).
- `concurrency-governor.ts`'s limit is now advisory UI policy unless also enforced in Rust; decide enforcement location when implementing.
- **Schema gap (must close before this authority is real):** migrations `001–009` contain no `agents`/`clones`/`sandboxes` tables and no `clone_dir`/`base_sha`/`pi_session_id`/`container_id` columns. Until a new migration (`010+`) adds them, "Rust is the SQLite-persisted source of truth" is aspirational. This single migration unblocks crash/orphan recovery (#17/#18), clone tracking (#19), and the post-run diff (#21); land it as a shared prerequisite, not inside any one issue.
