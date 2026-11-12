# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Pluribus is a Tauri 2 + React 19 desktop application — a chat UI over AI coding agents, built on **assistant-ui** primitives. Backend selection is **model-driven via a provider registry** (`src/lib/providers/provider-registry.ts`): the registry resolves which provider owns a given model id (`ownsModel`) and delegates the session to it. Three providers are registered in `src/components/RuntimeProvider.tsx`:

1. **Agent SDK** (`src/lib/providers/agent-sdk-provider.ts`) — talks to a Bun sidecar (`sidecar/agent-sdk-bridge/`) running `@anthropic-ai/claude-agent-sdk`.
2. **Codex** (`src/lib/providers/codex-provider.ts`) — drives a Codex backend via Rust commands (`src-tauri/src/codex/`) over a Tauri `Channel`.
3. **Pi** (`src/lib/providers/pi-provider.ts`) — the strategic backend: drives the Pi harness via `pi --mode rpc`, brokered by the Rust `src-tauri/src/pi/` bridge, with each agent in a per-agent Docker **sandbox** against a per-agent **clone** (ADR [0002](docs/adr/0002-sandbox-as-safety-boundary.md)/[0005](docs/adr/0005-pi-rpc-protocol.md)).

The Rust backend is authoritative over agent lifecycle and status (ADR [0003](docs/adr/0003-rust-authoritative-orchestration.md)); state is persisted to SQLite (`pluribus.db`). Per CONTEXT.md, the older multi-provider/engine model (and the Tauri shell plugin) is intended to be retired once Pi supersedes it — treat **CONTEXT.md** as the source of truth for terminology and the sandbox/clone model.

## Build & Development Commands

```bash
# Compile the Bun sidecar binary (required before cargo tauri build)
bun run build:sidecar   # outputs to src-tauri/binaries/ with host triple suffix

# Development (starts Vite dev server on :1420 + Tauri window)
cargo tauri dev            # or: bun run tauri dev

# Build for production
cargo tauri build

# Frontend-only dev server (no Tauri window)
bun run dev

# Type-check + bundle frontend
bun run build
```

Package manager is **bun**. Unit tests use **vitest** (`tests/*.test.ts`). End-to-end
tests drive the built Tauri app with **WebdriverIO + tauri-driver** and record a
video (`bun run e2e:record`) — see `e2e/README.md`.

```bash
bun run e2e:build     # build the debug app the e2e harness drives
bun run e2e:record    # run e2e specs and record e2e/artifacts/pluribus-e2e.mp4
```

**PR rule:** every PR ships a short video demonstrating the fix/feature (the
`e2e` CI label records and uploads one; drag it into the PR). Backend-only or
docs PRs with no UI surface are exempt — note that in the PR instead.

## Architecture

### Data Flow

```
User Input → assistant-ui Runtime → Orchestrated ChatModelAdapter.run()
  → Provider registry resolves backend by model id
  → Provider drives agent process (Pi via Rust bridge / Codex via Rust / Agent SDK sidecar)
  → Stream events → Adapter yields content → assistant-ui renders
```

### Key Files

**Frontend — provider & orchestration layer**

- **`src/lib/providers/provider-registry.ts`** — Model-driven registry; `getByModel()` resolves the owning provider.
- **`src/lib/providers/types.ts`** — `ProviderType = "agent-sdk" | "codex" | "pi"`, `AgentProvider` contract.
- **`src/lib/providers/pi-provider.ts`** — Pi backend `ChatModelAdapter`; drives the Rust `pi_*` commands; uses `pi-steer.ts` for steer/abort.
- **`src/lib/providers/codex-provider.ts`** — Codex backend, via Rust `codex` commands over a Tauri `Channel`.
- **`src/lib/providers/agent-sdk-provider.ts`** — Agent SDK backend; manages the `AgentSdkSidecar`.
- **`src/lib/orchestration/orchestrated-adapter.ts`** — The `ChatModelAdapter` the runtime uses; routes a run to the right provider via the registry + agent registry.
- **`src/lib/orchestration/agent-registry.ts`** — Per-agent lifecycle/status, DB-backed crash recovery (`initFromDb`).
- **`src/lib/orchestration/agent-process-manager.ts`**, **`concurrency-governor.ts`**, **`write-serializer.ts`**, **`agent-status-store.ts`** — Process tracking, concurrency limits, write serialization, status store.

**Rust backend — Pi bridge (`src-tauri/src/pi/`)**

- **`service.rs`** — Reader/writer/supervisor tasks driving the Pi RPC session.
- **`io.rs`** — `PiIo`/`PiHandle` transport seam (`Host` process vs `Container` exec); the rest of the backend is transport-agnostic.
- **`container.rs`** — bollard Docker `docker exec` transport (the ADR 0002 sandbox).
- **`clone.rs`** — Per-agent `git clone --local` of the source repo (ADR 0002/0005).
- **`diff.rs`** — Post-run clone diff (`base_sha` → working tree).
- **`commands.rs`** — Tauri commands (`pi_start_session`, `pi_get_state`, `pi_clone_diff`, steer/abort, etc.).
- **`mod.rs`**, **`types.rs`** — Module wiring and shared types.

**Other**

- **`src-tauri/src/codex/`** — Codex backend bridge (service/commands/types).
- **`sidecar/agent-sdk-bridge/index.ts`** — Bun sidecar; NDJSON over stdin/stdout, streams `SDKMessage` events via `@anthropic-ai/claude-agent-sdk`.
- **`src/lib/db.ts`** — SQLite database layer (threads, messages, sessions, agents, clones, settings).
- **`src/lib/sqlite-thread-list-adapter.ts`** / **`sqlite-thread-history-adapter.tsx`** — assistant-ui thread-list / history persistence.
- **`src/components/RuntimeProvider.tsx`** — Registers the providers, builds the agent registry + orchestrated adapter, wires the runtime.
- **`src/components/ThreadWorkspace.tsx`** — Main layout: sidebar thread list + chat area.
- **`src/components/assistant-ui/thread.tsx`** — Chat UI using assistant-ui primitives.
- **`src-tauri/src/lib.rs`** — Tauri builder setup and command registration.
- **`src-tauri/capabilities/default.json`** — Shell permission grants.
- **`src-tauri/migrations/`** — SQLite schema migrations (currently `001`–`011`, including `010_agents.sql` and `011_clones.sql`).
- **`docker/sandbox-base/Dockerfile`** — `pi-base` sandbox image (Node + Pi).

### Sandbox & clone model (Pi backend)

Pi agents follow the sandbox/clone model from CONTEXT.md and ADR [0002](docs/adr/0002-sandbox-as-safety-boundary.md)/[0005](docs/adr/0005-pi-rpc-protocol.md):

- Each code-mutating agent gets its own **Clone** (`git clone --local` of the source repo, own `.git`, own `agent/<thread-id>` branch). The Clone — not the sandbox — is the isolation unit for code changes.
- The Clone is bind-mounted into a per-agent Docker **Sandbox** (the execution + safety boundary; no per-tool approval popups), and Pi is driven over `docker exec` (bollard). A host transport exists as a dev fallback.
- After a run, changes are reviewed via a post-run **clone diff** (`pi_clone_diff`, `base_sha` → working tree). Clones survive session end / app restart until explicitly disposed.
- `global_settings.pi_sandbox` selects the transport (`"host"` → host process, otherwise → container). The Settings UI toggle is deferred — set the DB row directly to override.

### Persistence Layer

The app uses **SQLite** (via `tauri-plugin-sql`) as its primary persistence backend, stored in `pluribus.db`. The database layer in `db.ts` manages:
- Thread metadata and ordering, message history per thread
- Agent status and per-agent **clones** (migrations `010_agents.sql`, `011_clones.sql`)
- Session state
- Global app settings (`global_settings` KV table — e.g. `pi_sandbox`)
- Schema migrations (tracked in `src-tauri/migrations/`)

### Sidecar / ExternalBin Gotchas

- **Target triple suffix**: Tauri `externalBin` requires binaries named `<name>-<target-triple>` (e.g., `agent-sdk-bridge-x86_64-unknown-linux-gnu`). `build:sidecar` auto-detects the triple via `rustc -vV | grep '^host' | cut -d' ' -f2`.
- **`Bun.which()` in compiled binaries**: `bun --compile` bundles run in a virtual FS (`/$bunfs/root/`). Any SDK or library that resolves executables via `PATH` will fail — use `Bun.which("claude")` at startup to capture the real path before the virtual FS takes over.

### Dev Event System

A circular buffer (500 entries max) logs all stream events from Claude CLI. The DevPanel (lazy-loaded, dev-only) subscribes via `useSyncExternalStore` for real-time inspection of session state, stream events, and Claude CLI output.

## Component Philosophy (Important)

- **UI components**: Always use shadcn/ui or Radix primitives. Never build custom UI components when these libraries provide equivalents.
- **LLM integration**: Always check what assistant-ui provides FIRST. Use its built-in adapters, hooks, primitives, and thread management before building custom solutions. When customization is needed, extend assistant-ui's components — don't bypass the framework.
- **General rule**: Search existing dependencies (assistant-ui, shadcn, Radix, lucide) for a pre-built solution before creating new components, hooks, or adapters.

## Tech Stack & Conventions

- **UI framework**: assistant-ui v0.12 primitives (not custom components) — follow its composition patterns (`ThreadPrimitive.Root > Viewport > Messages`, etc.)
- **Styling**: Tailwind CSS v4 + shadcn/ui (new-york style, slate base color). Use `cn()` from `@/lib/utils` for className merging.
- **shadcn config**: `components.json` — components go in `@/components/ui`, non-RSC mode, lucide icons
- **TypeScript**: Strict mode with `noUnusedLocals` and `noUnusedParameters` enforced
- **Path alias**: `@/*` maps to `src/*`
- **File naming**: kebab-case for files, PascalCase for components
- **Persistence**: SQLite via `tauri-plugin-sql` (`pluribus.db`) for threads, messages, and session state. In-memory Maps/Sets in claude-adapter.ts for runtime process state.
- **State**: Minimal Zustand (installed but lightly used)

## Known Issues

- **Pi backend is a POC** — Currently one agent (and one clone) per sandbox; shared-sandbox multi-clone routing is deferred. The Pi sandbox transport is selected by the `global_settings.pi_sandbox` DB row; the Settings UI toggle is deferred.
- **Provider/engine cleanup pending** — Per CONTEXT.md, the older agent-sdk/codex providers and the Tauri shell plugin are slated to be removed once Pi supersedes them.
- **No attachment adapter** — The UI has attachment components wired up but no `adapters.attachments` is configured, so attachments are non-functional.

## Agent skills

### Issue tracker

Issues and PRDs are tracked as GitHub issues in `OriginalByteMe/Pluribus` via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default canonical vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.
