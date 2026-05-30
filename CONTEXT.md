# Pluribus

Pluribus is a desktop command center for orchestrating AI coding agents across repositories. This glossary fixes the language we use to talk about the system. It is not a spec.

## Language

**Pi**:
The single coding-agent harness Pluribus standardizes on ([pi.dev](https://pi.dev/)) — a minimal, TypeScript/Node.js terminal coding harness.
_Avoid_: PyCoder, Pi Coder, "the SDK", "the coder" — all refer to Pi.

**Harness**:
The runtime that drives one agent's loop (model calls, tool execution, session history). In Pluribus there is exactly one harness type: **Pi**.
_Avoid_: engine, provider, adapter — these described the old multi-backend design and are being retired.

**Skill**:
A reusable, on-demand capability package (Pi's "Agent Skill") that an agent loads from the filesystem.
_Avoid_: tool (a Skill bundles tools but is not itself a single tool).

**Extension**:
A TypeScript module that adds tools, commands, events, or custom UI to Pi.
_Avoid_: plugin.

**Agent**:
A single **Pi** process driving one coding task. Runs either inside a **Sandbox** (driven via `pi --mode rpc` over `docker exec` stdio) or on the host (for agents that don't execute code). Bound to *at most one* **Clone**.
_Avoid_: thread, session (those are Pi's internal history concepts), provider/engine.

**Sandbox**:
A Docker container providing an execution environment (runtime, deps, where `bash`/builds/tests run). Created from a **Repo image**. The orchestrator may give an agent its own sandbox, place several agents in one shared sandbox, or run an agent with no sandbox at all. A sandbox is an *execution* boundary, not the isolation boundary for code changes.
_Avoid_: VM, environment (overloaded).

**Orchestrator**:
The authoritative layer (in the **Rust backend**) that launches agents, owns their lifecycle and status (SQLite, surviving webview reloads), and decides each agent's **Sandbox** and **Clone** allocation. The frontend is a *view* that rehydrates from it. The only thing that spawns agents in v1 (flat orchestration — agents do not spawn their own subagents). See [ADR 0003](docs/adr/0003-rust-authoritative-orchestration.md).
_Avoid_: scheduler, manager (overloaded).

**Repo image**:
The per-repository Docker image every **Sandbox** for that repo is created from. Built once per repo as two layers: a **Base layer** (the repo's own environment) overlaid with the **Agent layer**. Resolved via hybrid strategy: reuse existing repo config (.devcontainer / Dockerfile / compose) → deterministic stack detection → model-authored Dockerfile (a constrained author-loop, see [ADR 0004](docs/adr/0004-provisioning-constrained-author-loop.md)), in that order. Its definition lives **app-side** (`~/.pluribus/repos/<repo-id>/`, keyed by repo + base commit + manifest hashes) — the user's repo is never modified; the **Base layer** can optionally be exported back to the repo. Provisioning is triggered by an explicit user action ("set up sandbox").
_Avoid_: sandbox image when ambiguous with the running container.

**Base layer**:
The repo's own environment — its existing container config if present, else detected/generated. Augmented, never discarded.

**Agent layer**:
The Pluribus runtime overlaid onto the **Base layer** in every **Repo image**: Node + **Pi** + **Skills** + **Extensions**. This is what makes a plain repo environment agent-ready. MCP is *not* included (see below).

**Source repo**:
The user's actual repository, opened in Pluribus. The origin of every **Clone** and the integration target for agent work. Never run inside a sandbox; never mutated by an agent directly.
_Avoid_: origin, upstream (those name git remotes; the Source repo is a local path).

**Clone**:
A full `git clone --local` of the **Source repo** (own `.git`, own branch; objects hardlinked from the source, *not* `--shared`/alternates, so source `gc` can't corrupt it). Its `origin` is the Source repo's local path. **The isolation unit for code changes**: each agent that mutates code gets its own Clone, so parallel agents never collide — *regardless of whether they share a Sandbox*. Mounted into the agent's sandbox (at a distinct path when shared).
_Avoid_: worktree (explicitly rejected), checkout, copy.

## Relationships

- The **Orchestrator** launches **Agents**; each Agent is one **Pi** instance running one agent loop.
- One repo → one **Repo image** → one or more **Sandboxes**. A Sandbox hosts one or more Agents (orchestrator's choice).
- Each code-mutating Agent has its own **Clone** (the isolation unit); Agents may share a Sandbox while keeping separate Clones.
- An **Agent** loads **Skills** and **Extensions** from the filesystem; it uses Pi's native tools directly against its **Clone** — no tool overriding.
- Review & integrate (local-first, no network): Pluribus reads the mounted **Clone** to show its branch diff in the UI; on approval it pushes the agent branch from Clone → **Source repo** (local-path origin), where the user merges, cherry-picks, or discards. Remote/PR push is a deferred, gated escape (see [ADR 0002](docs/adr/0002-sandbox-as-safety-boundary.md)).
- **Clone retention:** because review/integrate happens *after* a run, a Clone must **survive session end and app restart until the user explicitly disposes of it** (status `active` | `merged` | `discarded`). It is not cleaned up on agent exit. (Resolves the "per a defined policy" placeholder in the POC issues.)

## Implementation notes

- **Pi transport (#18).** Pi runs either on the host (`HostProcess`, tokio child — #17 dev fallback) or inside a per-agent Docker container driven over `docker exec` via bollard (`ContainerExec` — the #18 default and ADR 0002's actual sandbox boundary). The transport seam is `pi::io::PiIo` (`#[async_trait]` → `PiTransport { stdout, stdin, handle: PiHandle::{Host|Container} }`); `service.rs`'s reader/writer/supervisor and the entire frontend are transport-agnostic. The bollard container code lives in `src-tauri/src/pi/container.rs`.
- **Sandbox selection.** `global_settings.pi_sandbox` selects the transport: default (and any non-`"host"` value) → container; `"host"` → host. The frontend reads the row and passes it to `pi_start_session`. **The Settings UI toggle is deferred** — set the DB row directly to override.
- **Base image (layered, not monolithic).** `docker/sandbox-base/Dockerfile` defines a constant `pi-base` target (`node:22-bookworm-slim` + pinned `@mariozechner/pi-coding-agent`, `ENTRYPOINT sleep infinity`) plus composable, opt-in toolchain overlays (`with-python`, `with-go`, …) for the agent's *workspace* language. #18 builds only `pi-base` (tag `pluribus-pi-sandbox:base`). Build it with `docker build --target pi-base -t pluribus-pi-sandbox:base docker/sandbox-base`. The backend only **checks** image presence (`inspect_image`) — no silent build (ADR 0004 deferred).
- **No baked key.** The API key reaches the container via the `docker exec` `env`, never baked into the image. Pi has no dotenv layer, so the spawner injects it explicitly.
- **Container lifecycle.** Containers are labeled `pluribus.managed=true`, named `pluribus-sandbox-<thread-id-prefix>`. A readiness gate (`get_state` round-trip, ~10s timeout) precedes the first prompt. `pi_stop` and window-close teardown stop+remove the container; app startup reconciles orphans by force-removing all `pluribus.managed=true` containers. Clone + bind-mount (#19), post-run diff (#21), and shared-container multi-exec are deferred.

## Flagged ambiguities

- **"PyCoder" (Python) → Pi (TypeScript).** The harness was described as a Python SDK ("PyCoder"). It is actually [pi.dev](https://pi.dev/), a **Node.js/TypeScript** harness. This contradiction drives the backend-language decision (a Go/Rust backend cannot embed Pi; it must drive Pi as a subprocess).
- **Subagents — RESOLVED (pending final confirm).** Pi has no built-in subagents. Pluribus uses **flat orchestration**: the **Orchestrator** launches all agents; agents do not spawn their own children in v1. "Subagent" was loose wording for "another agent the orchestrator launched." Model-driven nesting is deferred (would be a `spawn_subagent` Pi extension reusing the same agent machinery, recursively).
- **MCP — RESOLVED.** Pi has no MCP client. v1 and the POC use native Pi **Skills** + **Extensions** for all tooling. An MCP-bridge extension (Pi extension acting as an MCP client inside the sandbox) is **deferred** — built only when a concrete third-party MCP server is actually needed. "MCP skills" in earlier discussion meant Pi Skills, not the MCP protocol.
- **Tool approval — RESOLVED.** Pi's *native* tools have **no** per-tool approval round-trip (they run autonomously; `tool_execution_*` events are informational). Pluribus does **not** gate native tools. Control = observe live (`message_update`, `tool_execution_*`, `queue_update`) + `steer` + `abort` + `set_model` + post-hoc Clone diff review. **The Sandbox is the safety boundary, replacing approval popups** — which is also why Pi omits them by design. *Caveat:* Pi's RPC **does** expose an `extension_ui_request`/`extension_ui_response` round-trip that **Skills/Extensions** (not native tools) can invoke; the Rust bridge MUST answer it or the agent blocks. See [ADR 0005](docs/adr/0005-pi-rpc-protocol.md).
- **`steer` is not a mid-token interrupt — RESOLVED (empirical).** In `one-at-a-time` mode a `steer` is **queued** (confirmed by a `queue_update` event) and applied at the next **turn/tool boundary**, not mid-generation. To halt generation immediately, use `abort` (~instant). UI copy should say "applies at next step", not "stops now". See [ADR 0005](docs/adr/0005-pi-rpc-protocol.md).
- **Model provider — RESOLVED (empirical).** Pi is **provider-agnostic** (`--provider` / `--model <provider/id>` / `--api-key`, key read from env). It is **not** Anthropic-only — the POC drives OpenRouter (`deepseek/deepseek-v4-flash`) validated end-to-end. Pluribus must launch each agent with an arbitrary provider + model + key (injected into Pi's child-process env, never baked into an image), not assume `ANTHROPIC_API_KEY`.
- **"Provider / engine / adapter"** (Claude CLI, Agent SDK, Codex, Zed/ACP) are being **removed** — including the **Tauri shell plugin** they rely on. Pi replaces all of them; Pi is spawned directly by the Rust backend (host) or via bollard `docker exec` (sandbox), so it does **not** need the Tauri shell plugin. Timing: delete the old engines + the shell plugin in one cleanup pass once Pi supersedes them. (The only shell Pi needs is `/bin/bash` *inside* the Sandbox container — unrelated to the Tauri shell plugin.)
