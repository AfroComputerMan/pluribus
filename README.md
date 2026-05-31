# Pluribus

Pluribus is a Tauri 2 + React 19 desktop application — a chat UI over AI coding
agents. The frontend is built on [assistant-ui](https://www.assistant-ui.com/)
primitives; the Rust backend owns agent process lifecycle, and all state
(threads, messages, agents, clones, settings) is persisted in SQLite
(`pluribus.db`). The long-term direction is to standardize on a single agent
harness, **Pi**, running each agent in its own Docker sandbox against a
per-agent git clone — see [CONTEXT.md](CONTEXT.md) and [docs/adr/](docs/adr/).

## Engines / backends

The frontend selects a backend per agent via a **provider registry**
(`src/lib/providers/provider-registry.ts`). Selection is **model-driven**: the
registry resolves which provider handles a given model id (`getProviderForModel`), then
delegates the session to it. Three providers are registered today (see
`src/components/RuntimeProvider.tsx`):

- **Agent SDK** (`agent-sdk-provider.ts`) — talks to a compiled **Bun sidecar**
  (`sidecar/agent-sdk-bridge/`) that runs `@anthropic-ai/claude-agent-sdk` and
  streams `SDKMessage` events as NDJSON over stdin/stdout. Shipped as a Tauri
  `externalBin` (`binaries/agent-sdk-bridge`).
- **Codex** (`codex-provider.ts`) — drives a Codex backend through Rust commands
  (`src-tauri/src/codex/`) over a Tauri `Channel`.
- **Pi** (`pi-provider.ts`) — the strategic backend. Drives the Pi coding-agent
  harness via `pi --mode rpc`, brokered by the Rust `src-tauri/src/pi/` bridge.
  Each Pi agent runs in a **per-agent Docker sandbox** (driven over
  `docker exec` via bollard) operating on a **per-agent `git clone --local`** of
  the source repo. The sandbox is the safety boundary (no per-tool approval
  popups); changes are reviewed via a post-run clone diff. A host transport
  (`pi` as a tokio child, no container) exists as a dev fallback. See
  [ADR 0002](docs/adr/0002-sandbox-as-safety-boundary.md) and
  [ADR 0005](docs/adr/0005-pi-rpc-protocol.md).

> **Status.** All three providers are wired into the runtime. The Pi backend is
> the actively-developed direction and is currently a POC (one agent per
> sandbox; sandbox transport selected by the `global_settings.pi_sandbox` DB
> row, with the Settings UI toggle deferred — see CONTEXT.md "Implementation
> notes"). Per CONTEXT.md, the older provider/engine model (and the Tauri shell
> plugin) is intended to be retired once Pi supersedes it.

## Architecture

```
React / assistant-ui  ──IPC──►  Tauri (Rust) backend  ──►  agent processes
   (frontend view)               (authoritative)            (Pi / Codex / sidecar)
        │                              │
        └──────────  SQLite (pluribus.db)  ──────────┘
```

- **Frontend** (`src/`): assistant-ui runtime + a provider/orchestration layer
  (`src/lib/providers/`, `src/lib/orchestration/`) that chooses a backend per
  agent and renders streamed events.
- **Rust backend** (`src-tauri/`): authoritative over agent lifecycle and
  status (survives webview reloads). The `src-tauri/src/pi/` bridge spawns and
  supervises Pi, manages Docker sandboxes and per-agent clones, and computes the
  post-run diff. See [ADR 0003](docs/adr/0003-rust-authoritative-orchestration.md).
- **Persistence**: SQLite via `tauri-plugin-sql`, migrations in
  `src-tauri/migrations/`.

## Build & development

Package manager is **bun**. (See [CLAUDE.md](CLAUDE.md) / [AGENTS.md](AGENTS.md)
for full conventions.)

```bash
bun install               # install JS dependencies

# Compile the Bun sidecar binary (required before a Tauri production build)
bun run build:sidecar     # outputs to src-tauri/binaries/ with host-triple suffix

cargo tauri dev           # dev: Vite on :1420 + Tauri window (or: bun run tauri dev)
bun run dev               # frontend-only Vite dev server (no Tauri window)

bun run build             # build:sidecar + tsc + vite build
cargo tauri build         # production desktop build
```

The Pi sandbox backend additionally needs Docker and the base image:

```bash
docker build --target pi-base -t pluribus-pi-sandbox:base docker/sandbox-base
```

`vitest` is installed (`bun run vitest`); there is a `tests/` directory.

## Project layout

| Path | What's there |
|------|--------------|
| `src/` | React 19 + TypeScript frontend (assistant-ui) |
| `src/lib/providers/` | Backend providers + model-driven registry (agent-sdk, codex, pi) |
| `src/lib/orchestration/` | Orchestrated adapter, agent registry, process manager, concurrency |
| `src-tauri/` | Rust (Tauri 2) backend |
| `src-tauri/src/pi/` | Pi RPC bridge: service, transport, Docker, clone, diff, commands |
| `src-tauri/src/codex/` | Codex backend bridge |
| `src-tauri/migrations/` | SQLite schema migrations (`pluribus.db`) |
| `sidecar/agent-sdk-bridge/` | Bun sidecar running `@anthropic-ai/claude-agent-sdk` |
| `docker/sandbox-base/` | `pi-base` sandbox image (Node + Pi) |
| `docs/adr/` | Architecture Decision Records |
| `docs/plans/` | Design & implementation plans |

## Documentation

- [CLAUDE.md](CLAUDE.md) — guidance for Claude Code working in this repo
- [CONTEXT.md](CONTEXT.md) — domain glossary + implementation notes (single source of truth for terminology)
- [AGENTS.md](AGENTS.md) — repository guidelines (structure, style, build/test, PRs)
- [PROJECT_INDEX.md](PROJECT_INDEX.md) — file-level index of the codebase
- [docs/adr/](docs/adr/) — Architecture Decision Records (backend language, sandbox boundary, orchestration, provisioning, Pi RPC protocol)
- [docs/agents/](docs/agents/) — agent workflow docs (issue tracker, triage labels, domain)
