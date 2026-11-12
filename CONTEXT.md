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

## Factory language

The terms of the server-hosted factory ([ADR 0006](docs/adr/0006-server-hosted-software-factory.md)). The standing docs [`docs/product.md`](docs/product.md) and [`docs/technical.md`](docs/technical.md) use them.

**Factory**:
One project's agents, policy, skills, automations, runners, webhooks and scorers, declared as files in that project's `.factory/` folder (Warp's layout, extended) and run by the Pluribus server on the host. Pluribus Factory is the server and app that run every enrolled project's factory.
_Avoid_: pipeline, workflow, the bot.

**Work item**:
One request the factory acts on, tracked from intake to `done` or `cancelled`: usually a GitHub issue, or a new request from the inbox or the Factory API. Pluribus keeps it in SQLite with its **Stage** and mirrors it to GitHub labels. A card on the board is the view of one work item.
_Avoid_: ticket (the vault's PLU notes), task (except in the Factory API's `send_task` and `get_task`), job, card.

**Stage**:
Where a **Work item** is: `inbox`, `ready`, `triage`, `spec`, `building`, `ci-wait`, `review`, `done` or `cancelled`. It moves only by the state machine's rules: a feature needs an approved spec before `building` when the project's policy asks for one, and `done` needs a merged PR. `waiting_on_you` is a flag beside the stage, not a stage. The GitHub labels `ready-for-agent`, `agent-working`, `ci-wait`, `needs-info` and `ready-for-human` mirror stages; they are not stages.
_Avoid_: status, state, column, label.

**Handover**:
An agent's question to Noah, posted through `pluribus handover` in one fixed shape: the question, "My pick" and "If you say nothing". It is refused without the pick and the default. It posts one comment as the factory's GitHub App, sets `waiting_on_you` and `needs-info`, and pushes to Noah's phone; his reply wakes the **Run**. It is the last step of the rule every agent follows: look it up, default and record, otherwise hand over.
_Avoid_: escalation, ping, question (alone), "ask the user".

**Assumption**:
A default an agent took instead of a **Handover**, allowed when the change lands only on `dev`, is conservative or follows a precedent, and one small PR can undo it. Recorded with `pluribus assume`, listed on the PR, and capped per PR by `policy.yaml`.
_Avoid_: guess, default (alone).

**Foreman**:
The agent that triages each **Work item**, writes the spec for a feature and hands questions to Noah. It never writes code. Defined in `.factory/agents/foreman/agent.md`, ported from Kira's PM role.
_Avoid_: PM (Kira's name for it), orchestrator, manager, triage agent.

**Engineer**:
The agent that builds one **Work item** in its own git worktree: failing test first, push, open the PR, park on CI. Defined in `.factory/agents/engineer/agent.md`, ported from Kira's engineer role.
_Avoid_: implementer, coder, worker, developer.

**Reviewer**:
The agent that reads an **Engineer**'s PR and gives `APPROVE` or `CHANGES_REQUESTED` on a named head SHA. Only an approval on the PR's current head counts for the merge gate. Defined in `.factory/agents/reviewer/agent.md`.
_Avoid_: approver, critic.

**Run**:
One agent working on one **Work item** through one **Driver**, from start until it settles or dies. A run can park on CI or on a **Handover**, resume, and from PLU-127 hibernate. It has a run id, a per-run token that scopes the agent CLI to its work item, and a stored trace. In v0 each run is a T3 Code thread.
_Avoid_: session, thread (T3's name for what hosts a run in v0), job, execution.

**Runner**:
Where runs execute, declared in `.factory/runners/<name>.yaml`: the image a run's container starts from and its setup, in Warp's layout. In v0 the T3 Code server on the host is the only runner; PLU-127 adds Pluribus's own container runner.
_Avoid_: worker, host, machine.

**Driver**:
The adapter that starts, steers, stops and streams runs on one harness, behind the `Driver` interface in `apps/server/src/adapters/drivers/driver.ts`: `t3` first, then `omp-rpc`, `claude` and `codex`. The agent's `harness.type` picks it. A driver is not a provider: the provider is the account a run bills to.
_Avoid_: engine, adapter (alone), integration, provider.

**Scorer**:
A judge-model check in `.factory/scorers/<name>/scorer.md` that grades a sample of runs from their stored traces with one of its declared labels. A label it did not declare is recorded as an error, not a score. Pluribus starts with `tests-run` and `task-compliance`.
_Avoid_: eval (the screen is Evals and metrics), grader, test.

**Automation**:
A trigger and a prompt in `.factory/automations/<name>/automation.md`: on a `schedule` (cron) slot or a matching `webhook` delivery it starts a **Run** with that prompt.
_Avoid_: cron job, routine, workflow, hook.

**Webhook delivery**:
One inbound HTTP request to a webhook path, identified by its delivery id (`X-GitHub-Delivery` for GitHub). It is checked for signature, size and duplicates, answered 202 when accepted, and stored in the delivery log as accepted, duplicate or rejected. A duplicate changes nothing. The GitHub events it carries become work-item events.
_Avoid_: event (the domain event it maps to), hook call, payload (the body alone).

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
- **Container lifecycle.** Containers are labeled `pluribus.managed=true`, named `pluribus-sandbox-<thread-id-prefix>`. A readiness gate (`get_state` round-trip, ~10s timeout) precedes the first prompt. `pi_stop` and window-close teardown stop+remove the container; app startup reconciles orphans by force-removing all `pluribus.managed=true` containers.
- **Per-agent Clone (#19).** The **Clone** is the **isolation unit for code changes** — not the Sandbox. Each code-mutating agent gets its own `git clone --local <source_repo> <clone_root>/<thread_id>` on the host before the container starts. Objects are hardlinked from the source (efficient), but the Clone has its **own `.git`** — it is **not** `--shared`/alternates, so a `git gc` on the source repo cannot corrupt the Clone. The `base_sha` (`git rev-parse HEAD` on the source, captured **before** `git checkout -b agent/<thread-id>`) is stored in the `clones` table so #21 can run `git diff <base_sha> HEAD` deterministically. The clone directory is **bind-mounted** into the Sandbox container at `/workspaces/<thread-id>` (read-write); the Pi exec `working_dir` is set to that path (Pi has no `--cwd` flag — it uses its process cwd). Pi's native tools read and write the Clone directly; the Source repo on disk is never touched by an agent. **Committed state only:** `git clone --local` copies the source's committed objects; uncommitted working-tree changes in the Source repo are **not** present in the Clone. The agent always starts from `base_sha` (the last commit). **Retention:** a Clone is **not** deleted when the agent session ends or the container is removed. It survives app restarts. Disposal is **explicit** — the user (or a future automated flow) calls `dispose_clone`, which `rm -rf`s the directory and marks the row `discarded`. Status values: `active` (in use or awaiting review), `merged` (agent branch integrated), `discarded` (disposed). App startup reconciles the `clones` table against disk: directories with a `discarded` or missing row are removed; `active` clones are left untouched. **One agent per Sandbox (POC).** The current implementation places exactly one agent (and one Clone) per Sandbox container. Shared-Sandbox multi-Clone path routing — where two agents share a container but each has its own mount at `/workspaces/<thread-id>` — is **deferred**. **Review/diff UI and the `merged` transition** belong to #21; #19 produces the durable Clone + `base_sha` + branch that #21 reads. **Docker file-sharing constraint:** the bind-mount only works if `clone_root` lives under a path Docker Desktop shares with the host — otherwise `docker run -v` fails with *"path not shared from the host"*. `app_data_dir()` resolves under `/home` on Linux (`~/.local/share`) and `/Users` on macOS, both shared by default, so the default clone root is safe; a custom clone root outside the shared set would need adding in Docker Desktop settings. (Verified 2026-05-30: `/tmp` is **not** shared on the dev box.)

- **Post-run Clone diff — review loop (#21).** After a run completes, the user clicks **"Review changes"** (pull-model, not streamed live) on a completed thread that has a Clone row. The frontend reads `db.clones.getByThread(threadId)` → `{ clone_dir, base_sha }`, then invokes the Rust command `pi_clone_diff(clone_dir, base_sha)`. The backend runs `git -C <clone_dir> add -A -N` (intent-to-add — registers untracked new files in the index without staging content; harmless on a disposable Clone) then `git -C <clone_dir> --no-pager diff --find-renames --end-of-options <base_sha>`, which compares the **base commit directly to the current working tree** — the correct superset of everything the agent changed. **`git diff <base_sha> HEAD` (two-dot) is wrong here and returns 0 lines**: Pi's native `write`/`edit` tools mutate the working tree without committing, so `HEAD` still points at `base_sha` (empirically verified 2026-05-30). The command returns a discriminated `DiffResult`: `no_clone` (directory missing — button is hidden), `empty` (agent made no changes), `git_error { message }` (git failed), or `diff { files: Vec<FileDiff>, truncated, total_lines }` (never conflate these). Diffs are capped at ~10 000 lines with a truncation notice; each `FileDiff` carries `path`, `base_path` (rename source), `status` (`added | deleted | renamed | modified`), and `hunks` (raw unified-diff text). The UI renders each file via the shared `CodePanel` (`language="diff"`) in a collapsible `Section`. **Merge / local-push and the `merged` status transition are deferred to the next slice.**

- **Real-time control (#20).** The control model is **observe + steer + abort** — no per-tool approval (ADR 0002: the Sandbox is the safety boundary). **Steer** sends `{type:"steer", message:<string>}` to Pi out-of-band; it is **queued** (Pi emits a `queue_update` event to confirm) and applied at the next turn/tool boundary — UI copy says "applies at next step", not "stops now". **Abort** sends `{type:"abort"}` and halts the run promptly (~6 ms to `agent_end`). Because assistant-ui has no mid-turn message-injection API, steer input is out-of-band: it is rendered as a **transient annotation** on the active thread (not persisted to the messages table and not passed through the normal `run()` path). Controls are gated on the Rust-authoritative `agent_running` flag (from `pi_get_state`) — not on `thread.isRunning` in the frontend — to prevent stale UI state from enabling controls after a run ends. **Non-goals for this slice:** `follow_up` (post-run continuation) and mid-run `set_model` are deferred.

## Flagged ambiguities

- **"PyCoder" (Python) → Pi (TypeScript).** The harness was described as a Python SDK ("PyCoder"). It is actually [pi.dev](https://pi.dev/), a **Node.js/TypeScript** harness. This contradiction drives the backend-language decision (a Go/Rust backend cannot embed Pi; it must drive Pi as a subprocess).
- **Subagents — RESOLVED (pending final confirm).** Pi has no built-in subagents. Pluribus uses **flat orchestration**: the **Orchestrator** launches all agents; agents do not spawn their own children in v1. "Subagent" was loose wording for "another agent the orchestrator launched." Model-driven nesting is deferred (would be a `spawn_subagent` Pi extension reusing the same agent machinery, recursively).
- **MCP — RESOLVED.** Pi has no MCP client. v1 and the POC use native Pi **Skills** + **Extensions** for all tooling. An MCP-bridge extension (Pi extension acting as an MCP client inside the sandbox) is **deferred** — built only when a concrete third-party MCP server is actually needed. "MCP skills" in earlier discussion meant Pi Skills, not the MCP protocol.
- **Tool approval — RESOLVED.** Pi's *native* tools have **no** per-tool approval round-trip (they run autonomously; `tool_execution_*` events are informational). Pluribus does **not** gate native tools. Control = observe live (`message_update`, `tool_execution_*`, `queue_update`) + `steer` + `abort` + `set_model` + post-hoc Clone diff review. **The Sandbox is the safety boundary, replacing approval popups** — which is also why Pi omits them by design. *Caveat:* Pi's RPC **does** expose an `extension_ui_request`/`extension_ui_response` round-trip that **Skills/Extensions** (not native tools) can invoke; the Rust bridge MUST answer it or the agent blocks. See [ADR 0005](docs/adr/0005-pi-rpc-protocol.md).
- **`steer` is not a mid-token interrupt — RESOLVED (empirical).** In `one-at-a-time` mode a `steer` is **queued** (confirmed by a `queue_update` event) and applied at the next **turn/tool boundary**, not mid-generation. To halt generation immediately, use `abort` (~instant). UI copy should say "applies at next step", not "stops now". See [ADR 0005](docs/adr/0005-pi-rpc-protocol.md).
- **Model provider — RESOLVED (empirical).** Pi is **provider-agnostic** (`--provider` / `--model <provider/id>` / `--api-key`, key read from env). It is **not** Anthropic-only — the POC drives OpenRouter (`deepseek/deepseek-v4-flash`) validated end-to-end. Pluribus must launch each agent with an arbitrary provider + model + key (injected into Pi's child-process env, never baked into an image), not assume `ANTHROPIC_API_KEY`.
- **"Provider / engine / adapter"** (Claude CLI, Agent SDK, Codex, Zed/ACP) are being **removed** — including the **Tauri shell plugin** they rely on. Pi replaces all of them; Pi is spawned directly by the Rust backend (host) or via bollard `docker exec` (sandbox), so it does **not** need the Tauri shell plugin. Timing: delete the old engines + the shell plugin in one cleanup pass once Pi supersedes them. (The only shell Pi needs is `/bin/bash` *inside* the Sandbox container — unrelated to the Tauri shell plugin.)
- **Desktop app vs factory (ADR 0006).** The opening line and the entries for Agent, Harness, Orchestrator, Sandbox, Repo image and Clone describe the Tauri desktop app. [ADR 0006](docs/adr/0006-server-hosted-software-factory.md) moves Pluribus to a server-hosted factory and supersedes ADR 0001, 0002 and 0003 in part. Those entries stay as the record of the desktop app until it is removed (PLU-133); in factory work, use the Factory language above.
- **Agent in the factory.** In the desktop app an Agent is one Pi process. In the factory an agent is a role defined in `.factory/agents/<name>/agent.md` (the **Foreman**, **Engineer** and **Reviewer**, later a retro agent), and one agent working one **Work item** is a **Run**.
- **Harness in the factory.** The desktop app has one harness, Pi. The factory's `harness.type` is `claude` (the default: Claude Code, the official `claude` binary under Noah's login), `omp` (local models and API keys) or `codex` (ADR 0006, A1 as amended).
- **Clone vs worktree.** The desktop app rejected worktrees in favour of a per-agent Clone. The factory isolates code changes with one git worktree per **Work item**, cut from a clone pool on local disk (ADR 0006, PLU-106).
- **Orchestrator vs scheduler.** The desktop app's Orchestrator is its Rust backend. In the factory that authority is the server in `apps/server`, and its scheduler (PLU-107) is the part that claims, parks, resumes and reaps runs.
- **Provider in the factory.** The Harness entry avoids "provider" for a harness, and that still holds. In the factory a provider is the account a **Run** bills to: Claude Max through `claude`, an API key, or a local model (ADR 0006, A3 as amended). Never call a harness or a **Driver** a provider.
