# Keep the Rust/Tauri backend; defer any Go/Wails rewrite

**Status:** accepted (2026-05-29)

## Context & Decision

The pivot to a Pi-based agent harness raised the question of rewriting the backend from Rust/Tauri to Go/Wails. The original motivation — "the agent SDK is Python (PyCoder), so pick a friendlier host language" — turned out to be false: **Pi ([pi.dev](https://pi.dev/)) is a Node/TypeScript harness driven as a `pi --rpc` subprocess over stdio**, which is host-language-agnostic. We will **keep Rust/Tauri** and build the POC on it.

## Why

- The existing `codex/service.rs` already implements the exact runtime pattern Pi needs: a long-lived child process streaming JSON-RPC over stdio with Tokio (stdout reader, stdin writer, supervisor). Driving `pi --rpc` is the same shape.
- **bollard** (mature async Rust Docker client, v0.20) covers local Docker — build/exec/attach/stream — so Go's native Docker SDK is no longer a differentiator.
- Tauri is more mature than Wails; a rewrite also re-does `tauri-plugin-sql`, 7 migrations, and the IPC layer — high cost, zero user-facing gain.
- A backend rewrite competes directly with building the sandbox/agent features that are the point of this milestone.

## Conditions that would flip this to Go/Wails

Revisit only if, after the POC, any of these prove true:

1. **Most of the Rust does not survive the pivot** (<~20% reuse) — then "reuse" is a weak anchor and language preference dominates.
2. **Go iteration velocity materially exceeds Rust** for whoever maintains the concurrent-process + Docker layer.
3. **Container ambitions grow beyond a single Docker host** (Kubernetes, containerd, BuildKit, remote sandbox fleets) — that ecosystem is Go-native and compounds.

The POC on Rust/Tauri is itself the experiment that measures condition #1.

## Measurement (2026-05-29 codebase audit)

Condition #1 partially holds, so this decision is closer than the "Why" implies — recorded for honesty:

- The Rust backend is **only ~700 LOC**, of which `codex/` (~565) is replaced. Genuinely surviving Rust: `lib.rs`/`main.rs` (~131) plus the stdio-streaming *pattern* of `codex/service.rs`. So the backend is **largely greenfield regardless of language** — "reuse the Rust" is a weak anchor.
- The real switching cost of Go/Wails is **re-doing Tauri scaffolding** (`tauri-plugin-sql` + 9 migrations + IPC + shell/dialog) in the less-mature Wails — not lost backend logic.
- The bulk of existing work — **~3,500 LOC of orchestration/provider TypeScript** (`src/lib/orchestration/*`, `src/lib/providers/*`) — is **React/TS and language-neutral**, safe under either backend.

Decision stands (Rust for POC speed + Tauri maturity), but the deciding factors are now framework-scaffolding cost and dev velocity / container ambitions (#2, #3), not backend reuse (#1).

