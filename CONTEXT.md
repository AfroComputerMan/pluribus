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
A single **Pi** process driving one coding task. Runs either inside a **Sandbox** (driven via `pi --rpc` over `docker exec` stdio) or on the host (for agents that don't execute code). Bound to *at most one* **Clone**.
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

## Flagged ambiguities

- **"PyCoder" (Python) → Pi (TypeScript).** The harness was described as a Python SDK ("PyCoder"). It is actually [pi.dev](https://pi.dev/), a **Node.js/TypeScript** harness. This contradiction drives the backend-language decision (a Go/Rust backend cannot embed Pi; it must drive Pi as a subprocess).
- **Subagents — RESOLVED (pending final confirm).** Pi has no built-in subagents. Pluribus uses **flat orchestration**: the **Orchestrator** launches all agents; agents do not spawn their own children in v1. "Subagent" was loose wording for "another agent the orchestrator launched." Model-driven nesting is deferred (would be a `spawn_subagent` Pi extension reusing the same agent machinery, recursively).
- **MCP — RESOLVED.** Pi has no MCP client. v1 and the POC use native Pi **Skills** + **Extensions** for all tooling. An MCP-bridge extension (Pi extension acting as an MCP client inside the sandbox) is **deferred** — built only when a concrete third-party MCP server is actually needed. "MCP skills" in earlier discussion meant Pi Skills, not the MCP protocol.
- **Tool approval — RESOLVED.** Pi's RPC has *no* per-tool approval round-trip (tools run autonomously; `tool_execution_*` events are informational). Pluribus does **not** gate tools. Control = observe live + `steer` + `abort` + `set_model` + post-hoc Clone diff review. **The Sandbox is the safety boundary, replacing approval popups** — which is also why Pi omits them by design.
- **"Provider / engine / adapter"** (Claude CLI, Agent SDK, Codex, Zed/ACP) are being **removed**. Pi replaces all of them.
