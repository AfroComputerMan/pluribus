
# Issue #17 — Host Pi RPC Bridge: Implementation Plan

## 1. Goal & scope

Add a third agent backend, **Pi**, that runs `pi --mode rpc` as a long-lived Rust-managed child process and streams its output live into the existing assistant-ui chat. A user selects a Pi model, types a prompt, and sees a streaming reasoning+text response end-to-end, with no orphaned processes after the turn or on app exit. This reuses the `src-tauri/src/codex/` PROCESS pattern (spawn + stdout-reader + stdin-writer + supervisor tasks) and the TS `AgentProvider` pattern (`codex-provider.ts`), wired through the existing `ProviderRegistry` → `orchestrated-adapter` → assistant-ui path with **zero changes to the orchestrated adapter**.

**In scope (host only):** Rust `pi` module (`types.rs`, `service.rs`, `commands.rs`, `io.rs`, `mod.rs`); a `PiIo` seam (`HostProcess` now; `ContainerExec` stub for #18); a per-session `Mutex<HashMap<String, PiService>>` store (NOT a singleton); migration `010_agents.sql`; provider-agnostic API-key env injection; `extension_ui_request` auto-cancel; `pi_abort` (mid-turn) vs `pi_stop` (kill process); spawn/exit error events; skip the echoed `role:"user"` message; complete on `agent_end` (not `turn_end`); the `pi-provider.ts` TS provider + registry/RuntimeProvider wiring; a `PiToolDisplay` rendering case.

**Out of scope (explicitly deferred):** containers/clone/sandbox (#18/#19); user-facing `steer` and the steering UI (#20 — though `set_model` exists internally); session resume/persistence beyond the telemetry `agents` row (Pi runs are not resumable); model-switch UI. **Do NOT call `ctx.onProcessStarted`** for Pi (ADR 0003 — Rust owns PID tracking).

## 2. Architecture

The Rust `pi` module mirrors `codex/` but diverges on protocol (type-framed, not JSON-RPC), state shape (per-session HashMap, not singleton), and terminator (`agent_end`, not first `turn_end`). A `PiIo` trait abstracts the transport so #18 can swap `HostProcess` for `ContainerExec` without touching `service.rs` logic.

```
 assistant-ui Thread (ComposerPrimitive)
        │ run(options)
        ▼
 orchestrated-adapter.ts  ── getProviderForModel("openrouter/deepseek/...") ─┐
        │ yield* provider.run(ctx)                                           │
        ▼                                                          ProviderRegistry
 pi-provider.ts (id:"pi")                                                    │
   invoke("pi_start_session" → pi_prompt) ; listen("pi:event")              register(createPiProvider())
        │ Tauri IPC                          ▲ Tauri emit
        ▼                                    │
 ┌──────────────── src-tauri/src/pi/ ────────────────────────────────┐
 │ commands.rs  State<Mutex<HashMap<session_id, PiService>>>          │
 │   pi_start_session / pi_prompt / pi_abort / pi_stop / pi_get_state │
 │        │ lookup/insert                                             │
 │        ▼                                                           │
 │ service.rs  PiService { stdin_tx, subs(broadcast), pid, session }  │
 │   ┌── PiIo (trait): HostProcess(tokio child) | ContainerExec(stub) │
 │   ├── stdout_reader: BufReader.lines() → parse {type} → PiEvent ───┼─► app_handle.emit("pi:event", {session_id, …})
 │   │     • skip role:"user"/"toolResult"   • auto-answer ext_ui_req │
 │   │     • loop until agent_end                                     │
 │   ├── stdin_writer: mpsc<String> → write_all + b"\n" + flush (LF)  │
 │   └── supervisor: child.wait() → emit pi:event ProcessExit         │
 └────────────────────────────────────────────────────────────────────┘
                  │ spawns
                  ▼  pi --mode rpc --provider <p> --model <provider/id>
            (env: OPENROUTER_API_KEY injected; NO dotenv layer)
```

Streaming contract: the provider maintains a cumulative `pendingContent: ContentPart[]` and **yields the full array on every event** (assistant-ui diffs internally). `text_delta` → `{type:"text"}` slot, `thinking_delta` → `{type:"reasoning"}` slot, `tool_execution_start/end` → `{type:"tool-call"}` slot tracked by `toolCallId`. Pi's `assistantMessageEvent.contentIndex` is mapped through a separate `Map<contentIndex, pendingContentIndex>` — it is NOT the pendingContent index.

## 3. Task breakdown

Each task is independently committable and builds on the prior. CI gate per task is one of: **frontend** = `bun run build` (tsc + vite + sidecar compile); **rust** = `cargo check --all-targets`. The whole module must keep CI green at every step — so Rust files are added in dependency order with stubs that compile.

---

### Task 1 — `pi/types.rs` + `pi/mod.rs` (event enum, raw types)

**Files:** create `src-tauri/src/pi/mod.rs`, `src-tauri/src/pi/types.rs`.

`mod.rs` (mirror `codex/mod.rs`):
```rust
pub mod commands;
pub mod io;
pub mod service;
pub mod types;
```
(Declaring `commands`/`service`/`io` now means CI fails until Tasks 2–4 create them — so create all four files in this task as compiling stubs, or sequence `mod.rs` declarations to match. Recommended: create empty-but-compiling `service.rs`/`commands.rs`/`io.rs` stubs here, fill in later tasks.)

`types.rs` — `PiEvent` enum, `#[serde(tag = "type", rename_all = "snake_case")]`, `Clone + Serialize`, every variant carries `session_id` so the frontend can filter (mirrors codex's `thread_id` usage):
```rust
#[derive(Serialize, Clone, Debug)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PiEvent {
    AgentStart   { session_id: String },
    TurnStart    { session_id: String },
    TextDelta    { session_id: String, content_index: u32, delta: String },
    ThinkingDelta{ session_id: String, content_index: u32, delta: String },
    ToolStart    { session_id: String, tool_call_id: String, tool_name: String, args: serde_json::Value },
    ToolEnd      { session_id: String, tool_call_id: String, tool_name: String, result: serde_json::Value, is_error: bool },
    TurnEnd      { session_id: String },
    AgentEnd     { session_id: String },
    ProcessExit  { session_id: String, code: Option<i32> },
    ProcessError { session_id: String, message: String },
}
```
**Verify:** rust — `cargo check` compiles the new module (must be referenced via `mod pi;` stub in lib.rs in this task, or Task 5; simplest: add `mod pi;` here and accept that unused-warnings are fine, errors are not).

> Note: because `lib.rs` `generate_handler!` will not reference pi commands until Task 5, add `#[allow(dead_code)]` on `PiService`/commands as needed to keep `cargo check` clean of hard errors (warnings are advisory in CI).

---

### Task 2 — `pi/io.rs` (PiIo seam: HostProcess now, ContainerExec stub)

**Files:** create `src-tauri/src/pi/io.rs`.

Define the transport seam so #18 swaps implementation without touching `service.rs`:
```rust
use tokio::process::{Child, ChildStdin, ChildStdout};

/// Transport abstraction for a pi --mode rpc process.
/// HostProcess = local tokio child (this issue). ContainerExec = docker exec (#18).
pub trait PiIo {
    /// Spawn and return (child, stdout, stdin). Key already injected into env.
    fn spawn(&self, provider: &str, model: &str, api_key: &str)
        -> Result<(Child, ChildStdout, ChildStdin), String>;
}

pub struct HostProcess;
impl PiIo for HostProcess {
    fn spawn(&self, provider: &str, model: &str, api_key: &str)
        -> Result<(Child, ChildStdout, ChildStdin), String> {
        let mut child = tokio::process::Command::new("pi")
            .args(["--mode", "rpc", "--provider", provider, "--model", model])
            .env("OPENROUTER_API_KEY", api_key) // Pi has NO dotenv layer
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn pi: {e}"))?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stdin  = child.stdin.take().ok_or("no stdin")?;
        Ok((child, stdout, stdin))
    }
}

/// STUB for #18 — container exec transport. Compiles, returns Err.
#[allow(dead_code)]
pub struct ContainerExec { pub container_id: String }
impl PiIo for ContainerExec {
    fn spawn(&self, _p: &str, _m: &str, _k: &str)
        -> Result<(Child, ChildStdout, ChildStdin), String> {
        Err("ContainerExec not implemented (deferred to #18)".into())
    }
}
```
Note: env key name (`OPENROUTER_API_KEY`) is a parameter for provider-agnostic injection — pass the **key name** and value from `commands.rs` instead of hardcoding (see Task 4). Keep `--mode rpc` BEFORE `--provider`/`--model` (verified arg order).

**Verify:** rust — `cargo check`.

---

### Task 3 — `pi/service.rs` (spawn + 3 tasks + per-session broadcast + ext_ui auto-answer)

**Files:** create `src-tauri/src/pi/service.rs`.

Struct (per-session, NOT singleton — one `PiService` per session lives inside the HashMap):
```rust
pub struct PiService {
    stdin_tx: mpsc::Sender<String>,
    /// Single broadcast channel for THIS session's events.
    events: broadcast::Sender<PiEvent>,
    next_id: Arc<AtomicU64>,   // seeded for future get_state/set_model ack correlation
    child_pid: u32,
    session_id: String,
}
```

`start(session_id, provider, model, api_key, app_handle, io: &dyn PiIo) -> Result<Self>`:
1. `let (mut child, stdout, stdin) = io.spawn(&provider, &model, &api_key)?;`
2. `let (events, _) = broadcast::channel::<PiEvent>(1024);` (higher than codex's 256 — Pi emits high-rate token deltas; lagged receivers drop events).
3. `let (stdin_tx, stdin_rx) = mpsc::channel::<String>(256);`
4. **stdout_reader** task — copy codex `BufReader::new(stdout).lines()` loop, but parse by `msg.get("type")`:
   - `"response"` → ignore (ack only; id is echo). Do NOT build a pending-oneshot map for `prompt`.
   - `"agent_start"` → `PiEvent::AgentStart`; `"turn_start"` → `TurnStart`; `"turn_end"` → `TurnEnd`; `"agent_end"` → `AgentEnd`.
   - `"message_start"/"message_end"` → inspect `role`; **skip when `role == "user"` or `role == "toolResult"`** (echoed). Otherwise no direct emit (deltas carry the content).
   - `"message_update"` → read `assistantMessageEvent`; on `text_delta` emit `TextDelta { content_index, delta }`; on `thinking_delta` emit `ThinkingDelta { content_index, delta }`. **Read `delta` only, never `message.content`.** Ignore `*_start`/`*_end` sub-events (or use them to reset indices in the provider).
   - `"tool_execution_start"` → `ToolStart`; `"tool_execution_end"` → `ToolEnd`.
   - `"extension_ui_request"` → extract echoed `id`, immediately send via `stdin_tx`: `{"type":"extension_ui_response","id":<id>,"cancelled":true}` + LF. **(VERIFIED shape — `cancelled:true`, keyed by `id`; NOT `action:"cancel"`.)** Blocks the agent forever if unanswered. Then continue (do not surface to UI in #17).
   - Emit each `PiEvent` BOTH on the per-session broadcast (`let _ = events.send(ev.clone());`) AND `app_handle.emit("pi:event", &ev)` so the frontend listener (which filters by `session_id`) receives it. (Codex routes via broadcast→command-task→emit; for Pi the reader can emit directly since events already carry `session_id`.)
5. **stdin_writer** task — IDENTICAL to codex lines 246–262: drain `stdin_rx`, `write_all(line.as_bytes())`, `write_all(b"\n")`, `flush()`. Strict LF.
6. `let child_pid = child.id().unwrap_or(0);` — **before** the supervisor move.
7. **supervisor** task — `let status = child.wait().await;` then `app_handle.emit("pi:event", &PiEvent::ProcessExit { session_id, code })`. **Exit code 0 is normal** (stdin EOF / abort) — do NOT treat as error. Only emit `ProcessError` on spawn failure (inline in `start`, before tasks run).
8. **DELETE the codex initialize handshake** (codex lines 282–305) — Pi has none.

Methods:
- `prompt(&self, message) -> Result<()>` — send `{"type":"prompt","message":message}`; fire-and-forget (return immediately; events arrive on the stream). (Optionally parse `turn_id` later — not needed for #17.)
- `abort(&self) -> Result<()>` — send `{"type":"abort"}`.
- `set_model(&self, provider, model_id)` and `get_state(&self)` — send the respective command (seed for #20; `get_state` may parse the ack via a small pending map later, but for #17 fire-and-forget is acceptable).
- `subscribe(&self) -> broadcast::Receiver<PiEvent>` — `self.events.subscribe()`.
- `pid(&self) -> Option<u32>`.
- `shutdown` is implicit: dropping `stdin_tx` closes the pipe → pi exits code 0 (~6ms). `pi_stop` additionally `kill`s as a safety net.

**Verify:** rust — `cargo check` (service compiles; reader/writer/supervisor type-check).

---

### Task 4 — `pi/commands.rs` (pi_start_session / pi_prompt / pi_abort / pi_stop / pi_get_state)

**Files:** create `src-tauri/src/pi/commands.rs`.

State type — **per-session HashMap, NOT `Option<T>`**:
```rust
type PiState = Mutex<HashMap<String, PiService>>;
```

Commands (all `#[tauri::command] pub async fn`, return `Result<_, String>`):
```rust
pub async fn pi_start_session(app_handle: AppHandle, state: State<'_, PiState>,
    session_id: String, provider: String, model: String) -> Result<(), String>;
// resolve api key (see below), spawn PiService via HostProcess, insert into map keyed by session_id.
// If key already present, no-op (idempotent) — prevents spawning duplicate children per session.

pub async fn pi_prompt(state: State<'_, PiState>, session_id: String, message: String)
    -> Result<(), String>;
// lock-release-before-stream (mirror codex commands.rs:63-84): lock map, get &PiService,
// call svc.prompt(message), DROP the guard. Events flow via the reader's emit + per-session broadcast.

pub async fn pi_abort(state: State<'_, PiState>, session_id: String) -> Result<(), String>;
// lock, lookup, svc.abort().

pub async fn pi_stop(state: State<'_, PiState>, session_id: String) -> Result<(), String>;
// lock, REMOVE from map (drops PiService → drops stdin_tx → pi gets EOF → exits 0).
// Best-effort kill_pid(pid) as safety net.

pub async fn pi_get_state(state: State<'_, PiState>, session_id: String)
    -> Result<serde_json::Value, String>;
```

**API-key resolution (provider-agnostic):** read from the environment by a name derived from `provider` (POC: `provider=="openrouter"` → `OPENROUTER_API_KEY`). Use `std::env::var(key_name)`. If missing, return `Err("OPENROUTER_API_KEY not set")` (surfaces as a crash toast). The launcher env is inherited but the key must be explicitly injected into the child via `io.rs` (Pi has no dotenv).

`HostProcess` instance: construct `&HostProcess` inline in `pi_start_session` and pass to `PiService::start`.

**Verify:** rust — `cargo check`.

---

### Task 5 — `lib.rs` wiring (mod, state, handler)

**Files:** edit `src-tauri/src/lib.rs`.

- After `mod codex;` add `mod pi;`.
- Add imports: `use pi::commands::{pi_start_session, pi_prompt, pi_abort, pi_stop, pi_get_state};` and `use pi::service::PiService;`.
- In `.setup(|app| { … })` after the codex `app.manage(...)`:
  ```rust
  app.manage(Mutex::new(std::collections::HashMap::<String, PiService>::new()));
  ```
- In `generate_handler![ … ]` append: `pi_start_session, pi_prompt, pi_abort, pi_stop, pi_get_state,`.

**Verify:** rust — `cargo check --all-targets` must be green (this is the first task where the full backend, including command registration, compiles end-to-end).

---

### Task 6 — Migration `010_agents.sql` (restart survival telemetry)

**Files:** create `src-tauri/migrations/010_agents.sql`; edit `src-tauri/src/lib.rs` migrations vec.

SQL (snake_case, TEXT timestamps via `strftime`, matching `008`):
```sql
CREATE TABLE IF NOT EXISTS agents (
  agent_id        TEXT PRIMARY KEY,
  session_id      TEXT,
  thread_id       TEXT,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running', -- running|completed|error
  current_turn_id TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now')),
  exited_at       TEXT,
  exit_code       INTEGER
);
CREATE INDEX IF NOT EXISTS idx_agents_thread_id ON agents(thread_id);
CREATE INDEX IF NOT EXISTS idx_agents_status    ON agents(status);
```
Register in `lib.rs` migrations vec (after version 9, contiguous):
```rust
Migration {
    version: 10,
    description: "agents_table_pi_restart_survival",
    sql: include_str!("../migrations/010_agents.sql"),
    kind: MigrationKind::Up,
},
```
For #17 this table is telemetry/restart-survival only — populating it from the provider is best-effort (see Task 7); no resume logic.

**Verify:** rust — `cargo check` (`include_str!` resolves at compile time → a missing/renamed file fails the build, proving the migration is wired).

---

### Task 7 — `pi-provider.ts` (TS AgentProvider) + PI_MODELS

**Files:** create `src/lib/providers/pi-provider.ts`; edit `src/lib/models.ts`.

`models.ts` — add:
```ts
export interface PiModel { id: string; label: string; family: string; supportsEffort: boolean; }
export const PI_MODELS: PiModel[] = [
  { id: "openrouter/deepseek/deepseek-v4-flash", label: "DeepSeek V4 Flash (Pi)", family: "deepseek", supportsEffort: false },
];
export const DEFAULT_PI_MODEL_ID = "openrouter/deepseek/deepseek-v4-flash";
export function isPiModel(id: string): boolean { return PI_MODELS.some(m => m.id === id); }
```
Also extend `getModelById` to search `PI_MODELS`.

`pi-provider.ts` — mirror `codex-provider.ts` structure. Key points:
- `id: "pi"`, `displayName: "Pi"`, `supportedModels: PI_MODELS.map(m => m.id)`.
- `capabilities`: `{ supportsResume:false, supportsApproval:false, supportsSubAgents:false, supportsMcp:false, supportsEffort:false }`.
- Local `type ContentPart = NonNullable<ChatModelRunResult["content"]>[number];`.
- TS event type matching Rust serde output (snake_case `type` tag): `PiEvent` union with the variants from Task 1.
- `run(ctx)`:
  1. `if (!ctx.prompt.trim()) return;`
  2. Derive `provider` from model id prefix (`"openrouter"`); `session_id = ctx.threadId` (1:1 for #17).
  3. `await invoke("pi_start_session", { sessionId, provider, model: ctx.model });`
  4. **Do NOT call `ctx.onProcessStarted`** (ADR 0003).
  5. Set up the queue+notify+push() idiom **verbatim from codex** (`codex-provider.ts:270-294`).
  6. `listen<PiEvent>("pi:event", ({payload}) => { if (payload.session_id !== sessionId) return; push(payload); })` — await the unlisten promise before prompting.
  7. `await invoke("pi_prompt", { sessionId, message: ctx.prompt });`
  8. Abort: `onAbort = () => { invoke("pi_abort", { sessionId }).catch(...); push({_done:true}); }`; attach to `ctx.abortSignal` (`{once:true}`); call immediately if already aborted.
  9. Event loop (copy codex `while (!closed)` structure). Maintain:
     - `pendingContent: ContentPart[]`
     - `textIdxByContentIndex = new Map<number, number>()` and `reasoningIdxByContentIndex = new Map<number, number>()` (Pi `content_index` → pendingContent index)
     - `toolIdxById = new Map<string, number>()`
     - Reset these maps on `turn_start` (each turn has its own content indices).
  10. Mapping:
      - `text_delta`: look up/create a `{type:"text"}` slot for `content_index`, append `delta`, yield `{ content:[...pendingContent] }`.
      - `thinking_delta`: same but `{type:"reasoning"} as ContentPart` (cast — same as agent-sdk-provider:563).
      - `tool_start`: push `{ type:"tool-call", toolCallId, toolName, args, argsText: JSON.stringify(args) }`, record `toolIdxById`, yield.
      - `tool_end`: update the same slot with `result`/`isError`, yield.
      - `turn_end`: do nothing (intermediate — loop continues).
      - `agent_end`: `closed = true; yield { content:[...pendingContent], status:{type:"complete", reason:"stop"} };`
      - `process_error`: `throw new Error(...)`.
      - `process_exit` with non-zero `code` mid-stream: `throw new Error("pi exited unexpectedly")`; code 0 mid-stream after abort → treat as done.
  11. `catch`: `if (ctx.abortSignal.aborted) yield { content:[], status:{type:"incomplete", reason:"cancelled"} }; else throw;` (copy codex:410-418).
  12. `finally`: remove abort listener, await+call unlisten.
  13. Best-effort persist: on `agent_end`, `db.threads.updatePiStatus(threadId, "completed")` (if helper added — optional for #17).
- `interrupt(threadId)`: `await invoke("pi_abort", { sessionId: threadId });` (mirrors codex's interrupt path).

**Verify:** frontend — `bun run build` (tsc strict + noUnusedLocals must pass; this catches the missing `"pi"` id union — see Task 8, so Task 8 may need to land first or together).

---

### Task 8 — Widen `AgentProvider.id` union + register provider

**Files:** edit `src/lib/providers/types.ts`; edit `src/components/RuntimeProvider.tsx`.

- `types.ts:50` — change `readonly id: "agent-sdk" | "codex";` → `readonly id: "agent-sdk" | "codex" | "pi";`.
- `RuntimeProvider.tsx` — add `import { createPiProvider } from "@/lib/providers/pi-provider";` and, at module level alongside the existing registrations (line ~38): `providerRegistry.register(createPiProvider());`.

> Sequencing: Tasks 7 and 8 together produce a green frontend. Commit 7+8 as one unit, or land 8 first (union widening + registration referencing a minimal provider). The `orchestrated-adapter.ts` and `provider-registry.ts` need **no changes** — registry lookup and `yield* provider.run(ctx)` already route by model id.

**Verify:** frontend — `bun run build` green; the registry now resolves `openrouter/deepseek/deepseek-v4-flash` → pi provider.

---

### Task 9 — `PiToolDisplay` rendering + thread.tsx switch case

**Files:** create `src/components/assistant-ui/pi-tool-display.tsx`; edit `src/components/assistant-ui/thread.tsx` (the `ToolCallDisplay` switch ~line 1018).

- `pi-tool-display.tsx`: a `ToolCallMessagePartComponent` (type from `@assistant-ui/react`) reusing the `Section`/`CodePanel` primitives pattern from `codex-tool-display.tsx`. Render `toolName` + pretty-printed `argsText` (JSON) and, when present, `result`/`isError` styling.
- `thread.tsx` switch: add a fallback case routing Pi tool names to `<PiToolDisplay {...props} />`. Since Pi `toolName` values are dynamic (skill/native tool names), route via the `default:` branch OR add explicit cases as discovered. Minimum: keep `ToolFallback` working; add `PiToolDisplay` for known names. (For the POC, `ToolFallback` is acceptable if `argsText` is populated — so this task is low-risk and can be deferred if tools don't appear in smoke testing.)

**Verify:** frontend — `bun run build` green.

## 4. Protocol mapping table

| Pi event / command | Rust handling (`service.rs` reader) | assistant-ui output (`pi-provider.ts`) |
|---|---|---|
| send `{type:"prompt",message}` | `pi_prompt` → `svc.prompt()`, fire-and-forget, drop lock | start of `run()` after `pi_start_session` |
| `{type:"response",command:"prompt",success:true}` (ack) | **ignored** (id is echo; not a terminator) | not surfaced; loop continues to events |
| `message_start/end` `role:"user"` (echoed prompt) | **skipped** in reader (role check) | never yielded — no duplicate user bubble |
| `message_start/end` `role:"toolResult"` | **skipped** in reader | not yielded as new content |
| `message_update` `text_delta {contentIndex,delta}` | emit `PiEvent::TextDelta` | append to `{type:"text"}` slot via `textIdxByContentIndex`, yield cumulative |
| `message_update` `thinking_delta {contentIndex,delta}` | emit `PiEvent::ThinkingDelta` | append to `{type:"reasoning"}` slot, yield (rendered in `MessagePrimitive.GroupedParts` / Agent activity) |
| `tool_execution_start {toolCallId,toolName,args}` | emit `PiEvent::ToolStart` | push `{type:"tool-call", …, argsText}`, record slot, yield |
| `tool_execution_end {toolCallId,result,isError}` | emit `PiEvent::ToolEnd` | update same slot, yield |
| `turn_end {message,toolResults}` | emit `PiEvent::TurnEnd` | **no-op** — intermediate, loop continues |
| `agent_end {messages}` | emit `PiEvent::AgentEnd` | **TERMINATOR**: yield `{content, status:{complete,stop}}`, close loop |
| abort: send `{type:"abort"}` | `pi_abort` → `svc.abort()` | `onAbort` fires; loop drains until `agent_end` (~6ms); catch yields `{incomplete,cancelled}` |
| `extension_ui_request {id,…}` | reader auto-sends `{type:"extension_ui_response",id,cancelled:true}` via stdin (VERIFIED shape) | not surfaced (auto-cancelled — prevents deadlock) |
| process exit (stdin EOF / `pi_stop`) | supervisor emits `ProcessExit{code}` (code 0 = normal) | code 0 → done; non-zero mid-stream → throw → crash toast |
| spawn failure | inline `Err` from `pi_start_session` | `invoke` rejects → orchestrated-adapter `catch` → crash toast |

## 5. Acceptance criteria

- [ ] **Rust spawns `pi --mode rpc` as a long-lived child** — `HostProcess::spawn` with verified arg order; `pi_start_session` creates one `PiService` per session. _Verify:_ `cargo check` green; smoke run shows a `pi` process appears in `ps` after first prompt.
- [ ] **Strict LF JSONL r/w** — stdin_writer uses `write_all(b"\n")` (not `writeln!`); reader uses `BufReader::lines()`. _Verify:_ code review + smoke (events parse without truncation).
- [ ] **Tauri commands for start/prompt/abort/stop** — `pi_start_session`, `pi_prompt`, `pi_abort`, `pi_stop` registered in `generate_handler!`. _Verify:_ `cargo check`; `pi_get_state` callable.
- [ ] **Events emitted and rendered live** — `pi:event` carries `session_id`; provider filters and yields cumulative content. _Verify:_ smoke — reasoning + text stream incrementally in chat.
- [ ] **Typing a prompt → streaming response end-to-end** — full path through orchestrated-adapter to `agent_end`. _Verify:_ manual smoke with OpenRouter key.
- [ ] **Process cleaned up (no orphans)** — `pi_stop` removes from map (EOF → exit 0); existing `processManager.cleanupOrphans()` covers crash recovery; supervisor emits `ProcessExit`. _Verify:_ after a turn and on app exit, no stray `pi` process in `ps`.
- [ ] **PiIo seam present** — `HostProcess` (live) + `ContainerExec` (stub) implement `PiIo`. _Verify:_ `cargo check`; `service.rs::start` takes `&dyn PiIo`.
- [ ] **Per-session `Mutex<HashMap>`** (not singleton). _Verify:_ code review; concurrent threads spawn distinct children.
- [ ] **Migration 010 applied** — `agents` table created at DB init. _Verify:_ `cargo check` (`include_str!`); smoke (no SQL migration error on boot).
- [ ] **Provider-agnostic key injection** — key resolved by provider name, injected via child env. _Verify:_ code review; smoke fails clearly if key unset.
- [ ] **extension_ui_request answered** — auto-cancel. _Verify:_ code review (no hang on skill/extension flows).
- [ ] **`pi_abort` vs `pi_stop` distinct** — abort = mid-turn, stop = kill. _Verify:_ code review + smoke (abort stops a turn promptly; thread remains usable).
- [ ] **`onProcessStarted` NOT called** for Pi (ADR 0003). _Verify:_ code review of `pi-provider.ts`.
- [ ] **Echoed user message skipped; complete on `agent_end`.** _Verify:_ smoke — no duplicate user bubble; response completes (not stuck after first `turn_end`).

## 6. Verification strategy

No local Rust/bun toolchain — verification is push→CI→read→fix:

1. **Branch & push** `feat/17-pi-rpc-bridge`. Open a draft PR so CI (`.github/workflows/ci.yml`) runs on `pull_request`.
2. **Read the run:** `gh run list --branch feat/17-pi-rpc-bridge` then `gh run view <id> --log-failed` to read failures. The two **gating** steps are:
   - `Build frontend + sidecar` (`bun run build` = tsc strict + vite + `bun --compile` sidecar) — gates all TS tasks (7, 8, 9) and catches the `id` union error, missing imports, unused locals.
   - `cargo check --all-targets` (in `src-tauri`) — gates all Rust tasks (1–6).
   - `cargo fmt`/`cargo clippy` are `continue-on-error: true` (advisory) — do not block on them, but read clippy output and fix obvious issues.
3. **"Green" =** both gating steps pass. Iterate: push fix → re-read run. Commit Rust and TS tasks in an order that keeps each push green (Rust 1–6 are self-contained; TS 7+8 land together; 9 last).
4. **Manual smoke (requires a real machine with `pi` v0.67.68 + `OPENROUTER_API_KEY`):** since CI cannot run the GUI or a live `pi`, document a smoke checklist in the PR for a human/maintainer to run `cargo tauri dev`:
   - Export `OPENROUTER_API_KEY`; select the DeepSeek V4 Flash (Pi) model; send a prompt; confirm reasoning then text stream live and the turn completes.
   - Click stop/abort mid-turn; confirm prompt cancellation and that the thread is still usable.
   - Close the app; confirm no orphaned `pi` process (`pgrep -fl 'pi --mode rpc'`).
   - Confirm DB boots (migration 010 applied, no error).

## 7. Risks & open questions

### Resolved against the binary (pi v0.67.68, 2026-05-30) — implement to these
- **✅ `session_id` propagation:** CONFIRMED — `AgentEvent` (`@mariozechner/pi-agent-core/dist/types.d.ts`) carries **no** session/thread id. The reader MUST inject `PiService.session_id` into every emitted `PiEvent`. 1:1 `session_id == threadId` for #17.
- **✅ `contentIndex` semantics:** CONFIRMED (`pi-ai/dist/types.d.ts` `AssistantMessageEvent`) — every sub-event (`text_start/delta/end`, `thinking_start/delta/end`, `toolcall_start/delta/end`) carries `contentIndex: number` **and** `partial: AssistantMessage` (the full accumulated message). `contentIndex` indexes the *current* assistant message's `content[]` and restarts per message. **Recommended (robust) provider approach:** on each `message_update`, map **`assistantMessageEvent.partial.content`** → assistant-ui parts and yield the whole array, rather than hand-accumulating `delta`s + index maps. This removes the reset risk and the delta-accumulation bugs. (The delta approach in Task 3/§4 also works if `partial` is unavailable, but prefer `partial`.)
- **✅ `extension_ui_response` shape:** CONFIRMED (`rpc-types.d.ts`) — cancel = `{type:"extension_ui_response", id:<reqId>, cancelled:true}` (keyed by `id`; confirm/value variants use `confirmed`/`value`). **NOT** `action:"cancel"`.

### Still open (confirm during smoke / implementation)
- **Key env-var name beyond OpenRouter:** POC hardcodes `OPENROUTER_API_KEY`; generalize the provider→env-name map when more providers are added.
- **`broadcast` capacity vs token rate:** set to 1024; if smoke shows `Lagged` drops at high token rates, switch to per-session `mpsc` + Tauri `Channel<PiEvent>` (the v2-preferred approach) — deferred unless observed.
- **`cargo check` ≠ runtime:** CI proves compilation, not behavior. The streaming/abort/orphan criteria can only be confirmed by the manual smoke step.

**Explicit non-goals (deferred):** containers/clone/sandbox (#18 — `ContainerExec` is only a compiling stub); user-facing steer + steering UI (#20 — `steer`/`set_model` exist internally but are not surfaced); session resume/persistence beyond the telemetry `agents` row (#19/#21); model-switch UI mid-session.

## 8. Suggested commit sequence & PR

**Branch:** `feat/17-pi-rpc-bridge`

**Atomic commits (each keeps CI green):**
1. `feat(pi): add pi module skeleton — types.rs, mod.rs, compiling stubs` (Task 1 + empty service/commands/io stubs)
2. `feat(pi): add PiIo seam (HostProcess + ContainerExec stub)` (Task 2)
3. `feat(pi): implement PiService — spawn, stdout reader, stdin writer, supervisor, ext_ui auto-cancel` (Task 3)
4. `feat(pi): add Tauri commands — pi_start_session/prompt/abort/stop/get_state` (Task 4)
5. `feat(pi): register pi module, per-session state, and command handlers in lib.rs` (Task 5)
6. `feat(db): add migration 010 agents table for pi restart survival` (Task 6)
7. `feat(pi): add pi-provider, PI_MODELS, widen provider id union, register provider` (Tasks 7+8 together — green frontend)
8. `feat(ui): add PiToolDisplay and wire pi tool cases in thread switch` (Task 9)

**PR title:** `feat: host Pi RPC bridge (#17)`

**PR body outline:**
- **Summary** — long-lived `pi --mode rpc` child managed by Rust, streamed live into assistant-ui via a new `pi` provider; closes #17.
- **Architecture** — link the data-flow diagram; note codex-pattern reuse and the protocol divergences (type-framed, per-session HashMap, `agent_end` terminator, echoed-user skip, ext_ui auto-cancel).
- **De-risking for #18/#20** — `PiIo` seam, migration 010, internal `set_model`/`steer`.
- **Out of scope** — containers (#18), steer UI (#20), resume (#19/#21).
- **Verification** — CI green (`bun run build` + `cargo check`); attach the manual smoke checklist from §6 and request a maintainer run it with a live `pi` + OpenRouter key.
- Footer:
  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  ```
