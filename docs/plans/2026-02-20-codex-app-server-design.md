# Codex App Server Integration — Design Document

**Date**: 2026-02-20
**Status**: Approved for implementation
**Scope**: This feature only — Codex App Server via Rust backend
**Out of scope**: ACP bridge for other agents (documented here as future path only)

---

## 1. Problem Statement

The current Claude integration in Pluribus spawns a per-turn subprocess via Tauri's TypeScript shell plugin. This worked for Claude because the interaction is unidirectional — write a prompt, read a stream, done. The Codex App Server requires genuine bidirectionality: while it's streaming `item/agentMessage/delta` notifications, it can simultaneously pause a turn and issue a `turn/approval/requested` back to the client, which must respond before the agent continues. The TypeScript shell plugin pattern cannot handle this cleanly.

Additionally, the app needs a long-lived Codex process — one `codex app-server` instance per session, managing multiple threads — rather than the spawn-per-turn model used for Claude. This is a process lifecycle mismatch with the existing approach.

The solution is to move agent process management into the Tauri Rust backend, where Tokio gives us concurrent bidirectional stdio, proper long-lived `State<T>`, and a clean path to ACP integration later.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│  React / assistant-ui  (unchanged)                              │
│                                                                 │
│  RuntimeProvider                                                │
│    └── useRuntimeHook()                                         │
│          └── useLocalRuntime(adapter)                           │
│                ├── ClaudeAdapter  (unchanged)                   │
│                └── CodexAppServerAdapter  [NEW]                 │
│                      └── invoke() / listen()  ──┐              │
└──────────────────────────────────────────────────┼─────────────┘
                                                   │ Tauri IPC
┌──────────────────────────────────────────────────┼─────────────┐
│  Rust backend  (src-tauri/src/)                  │             │
│                                                  │             │
│  Tauri commands ◄────────────────────────────────┘             │
│    codex_start_thread                                           │
│    codex_send_turn                                              │
│    codex_approve_tool                                           │
│    codex_interrupt_turn                                         │
│    codex_get_auth_status                                        │
│                                                                 │
│  CodexService  (managed State<T>)                               │
│    ├── stdin_tx: mpsc::Sender<String>                           │
│    ├── pending: Arc<Mutex<HashMap<u64, oneshot::Sender>>>       │
│    └── thread_subs: Arc<Mutex<HashMap<threadId, broadcast>>>   │
│                                                                 │
│  Three Tokio tasks (lifetime = app session)                     │
│    ├── stdout_reader  — JSONL → route to pending / broadcast    │
│    ├── stdin_writer   — drain mpsc → write to process stdin     │
│    └── supervisor     — watch process, restart on crash         │
└───────────────────────────────────┬─────────────────────────────┘
                                    │ stdin / stdout (JSONL)
                    ┌───────────────▼──────────────┐
                    │  codex app-server  [process] │
                    │                              │
                    │  Thread Manager              │
                    │    ├── thread-1 (session A)  │
                    │    ├── thread-2 (session B)  │
                    │    └── ...                   │
                    └──────────────────────────────┘
```

---

## 3. App Server Protocol (Wire Format)

The Codex App Server uses **JSON-RPC lite over stdio**: newline-delimited JSON (JSONL), one message per line. The `"jsonrpc":"2.0"` header is omitted on the wire.

### Message types

**Requests** (client → server, have an `id`):
```jsonc
{ "method": "thread/start", "id": 1, "params": { "model": "gpt-5-codex-high" } }
{ "method": "turn/start",   "id": 2, "params": { "threadId": "t1", "input": [{ "type": "text", "text": "Fix the failing tests" }] } }
{ "method": "turn/interrupt","id": 3, "params": { "threadId": "t1", "turnId": "turn-42" } }
{ "method": "turn/approval/respond", "id": 4, "params": { "approvalId": "ap-7", "decision": "allow" } }
{ "method": "account/read", "id": 5, "params": {} }
```

**Responses** (server → client, echo the `id`):
```jsonc
{ "id": 1, "result": { "threadId": "t1" } }
{ "id": 5, "result": { "authMode": "chatgpt_oauth", "username": "noah@..." } }
```

**Notifications** (server → client, no `id`):
```jsonc
{ "method": "turn/started",             "params": { "threadId": "t1", "turnId": "turn-42" } }
{ "method": "item/started",             "params": { "threadId": "t1", "itemId": "i-1", "type": "agent_message" } }
{ "method": "item/agentMessage/delta",  "params": { "threadId": "t1", "itemId": "i-1", "delta": "Let me look at..." } }
{ "method": "item/completed",           "params": { "threadId": "t1", "itemId": "i-1", "item": { "type": "agent_message", "content": "..." } } }
{ "method": "item/completed",           "params": { "threadId": "t1", "itemId": "i-2", "item": { "type": "file_change", "path": "src/foo.ts", "diff": "..." } } }
{ "method": "item/completed",           "params": { "threadId": "t1", "itemId": "i-3", "item": { "type": "command_execution", "command": "cargo test", "output": "..." } } }
{ "method": "turn/approval/requested",  "params": { "threadId": "t1", "approvalId": "ap-7", "command": "rm -rf dist/", "reason": "cleanup" } }
{ "method": "turn/completed",           "params": { "threadId": "t1", "turnId": "turn-42", "usage": { "input_tokens": 1200, "output_tokens": 430 } } }
{ "method": "account/updated",          "params": { "authMode": "chatgpt_oauth", "username": "noah@..." } }
```

### Item types in `item/completed`

| `item.type`          | Meaning                                  | Maps to in UI           |
|----------------------|------------------------------------------|-------------------------|
| `agent_message`      | Text from the model                      | assistant text content  |
| `reasoning`          | Model chain-of-thought (if visible)      | collapsed thinking block|
| `file_change`        | File edited/created/deleted              | tool call display       |
| `command_execution`  | Shell command run                        | tool call display       |
| `web_search`         | Web search performed                     | tool call display       |
| `plan_update`        | Agent updated its internal plan          | tool call display       |
| `mcp_tool_call`      | MCP tool invoked                         | tool call display       |

---

## 4. Rust Backend

### 4.1 New files

```
src-tauri/src/
  lib.rs              — modified: register CodexService state + commands
  codex/
    mod.rs            — pub use
    service.rs        — CodexService, process management, JSON-RPC dispatcher
    commands.rs       — #[tauri::command] handlers
    types.rs          — Rust types for protocol messages and Tauri events
```

### 4.2 `types.rs` — Key types

```rust
// Outbound Tauri events (Rust → frontend)
#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    TurnStarted    { thread_id: String, turn_id: String },
    ItemDelta      { thread_id: String, item_id: String, delta: String },
    ItemCompleted  { thread_id: String, item_id: String, item: serde_json::Value },
    TurnCompleted  { thread_id: String, turn_id: String, usage: Usage },
    ApprovalNeeded { thread_id: String, approval_id: String, command: String, reason: Option<String> },
    AuthChanged    { auth_mode: String, username: Option<String> },
    ProcessError   { message: String },
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Usage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}
```

### 4.3 `service.rs` — CodexService

```rust
pub struct CodexService {
    // Write JSON-RPC requests here; stdin_writer task drains this
    stdin_tx: mpsc::Sender<String>,
    // Pending request/response correlations (by JSON-RPC id)
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>>,
    // Per-thread broadcast channels for streaming turn events
    thread_subs: Arc<Mutex<HashMap<String, broadcast::Sender<AgentEvent>>>>,
    // Monotonic request ID counter
    next_id: Arc<AtomicU64>,
}

impl CodexService {
    /// Spawn `codex app-server` and wire up the three Tokio tasks.
    pub async fn start(app_handle: AppHandle) -> Result<Self, String> { ... }

    /// Send a JSON-RPC request; await its response.
    pub async fn request(&self, method: &str, params: Value) -> Result<Value, String> { ... }

    /// Subscribe to streaming events for a specific thread.
    pub fn subscribe(&self, thread_id: &str) -> broadcast::Receiver<AgentEvent> { ... }
}
```

**Three Tokio tasks** (spawned in `start()`, live for the app session):

```
stdout_reader:
  loop {
    read one JSONL line from process stdout
    deserialize to serde_json::Value
    if has "id" field → look up pending HashMap, send to oneshot
    else → determine threadId from params, broadcast to thread_subs
           if method == "account/updated" → emit app-wide Tauri event
           if method == "turn/approval/requested" → emit AgentEvent::ApprovalNeeded
  }

stdin_writer:
  loop {
    receive String from stdin_tx
    write line + "\n" to process stdin
  }

supervisor:
  wait for process exit
  emit AgentEvent::ProcessError
  attempt restart after 2s back-off
  re-initialize (re-send codex/initialize handshake)
```

### 4.4 `commands.rs` — Tauri commands

```rust
#[tauri::command]
pub async fn codex_start_thread(
    state: State<'_, CodexService>,
    model: Option<String>,
) -> Result<String, String>
// Sends thread/start, returns threadId

#[tauri::command]
pub async fn codex_send_turn(
    state: State<'_, CodexService>,
    thread_id: String,
    input: String,
    cwd: Option<String>,
) -> Result<String, String>
// Sends turn/start, returns turnId
// Streaming events arrive via Tauri event "agent:event" from that point

#[tauri::command]
pub async fn codex_interrupt_turn(
    state: State<'_, CodexService>,
    thread_id: String,
    turn_id: String,
) -> Result<(), String>

#[tauri::command]
pub async fn codex_approve_tool(
    state: State<'_, CodexService>,
    approval_id: String,
    allow: bool,
) -> Result<(), String>

#[tauri::command]
pub async fn codex_get_auth_status(
    state: State<'_, CodexService>,
) -> Result<serde_json::Value, String>
// Sends account/read, returns auth mode + username
```

### 4.5 Tauri event channel

Streaming `AgentEvent` values are emitted from Rust to the frontend via:

```rust
app_handle.emit("agent:event", &event)
```

The frontend subscribes with `listen("agent:event", handler)`. All events carry a `thread_id` field so the adapter can filter for the active thread.

### 4.6 `lib.rs` changes

```rust
// Add to Cargo.toml:
// tokio = { version = "1", features = ["full"] }
// uuid = { version = "1", features = ["v4"] }

.setup(|app| {
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move {
        match CodexService::start(handle.clone()).await {
            Ok(svc) => { handle.manage(svc); }
            Err(e)  => { eprintln!("CodexService failed to start: {e}"); }
        }
    });
    Ok(())
})
.invoke_handler(tauri::generate_handler![
    greet,
    codex_start_thread,
    codex_send_turn,
    codex_interrupt_turn,
    codex_approve_tool,
    codex_get_auth_status,
])
```

---

## 5. TypeScript / React Layer

### 5.1 New files

```
src/lib/
  codex-adapter.ts           — implements ChatModelAdapter via Tauri IPC
  codex-approval-store.ts    — Zustand store for pending approval requests

src/components/
  RuntimeProvider.tsx        — modified: agent selector, mounts correct adapter
  assistant-ui/
    codex-tool-display.tsx   — renders file_change, command_execution, etc.
    approval-banner.tsx      — floating approval request UI
```

### 5.2 `codex-adapter.ts`

`CodexAppServerAdapter` implements `ChatModelAdapter` identically to `ClaudeAdapter` at the interface boundary. Internally it's thin — all the heavy lifting is in Rust.

```typescript
export function createCodexAdapter(): ChatModelAdapter {
  return {
    async run({ messages, abortSignal, context }) {
      const threadKey = context.threadId;

      // Resolve or create the Codex thread ID for this assistant-ui thread
      const codexThreadId = await getOrCreateCodexThread(threadKey);

      // Extract the latest user message
      const userText = extractUserText(messages);

      // Tell Rust to start the turn
      const turnId = await invoke<string>("codex_send_turn", {
        threadId: codexThreadId,
        input: userText,
        cwd: await resolveWorkspaceCwd(threadKey),
      });

      // Stream agent events back to assistant-ui
      return new ReadableStream({
        start(controller) {
          const unlisten = listen<AgentEvent>("agent:event", ({ payload }) => {
            if (payload.thread_id !== codexThreadId) return;

            switch (payload.type) {
              case "item_delta":
                controller.enqueue({ type: "text-delta", textDelta: payload.delta });
                break;
              case "item_completed":
                if (payload.item.type !== "agent_message") {
                  controller.enqueue({ type: "tool-call", ...mapItemToToolCall(payload.item) });
                }
                break;
              case "turn_completed":
                unlisten.then(f => f());
                controller.close();
                break;
              case "approval_needed":
                codexApprovalStore.getState().push(payload);
                break;
            }
          });

          abortSignal.addEventListener("abort", () => {
            invoke("codex_interrupt_turn", { threadId: codexThreadId, turnId });
            unlisten.then(f => f());
            controller.close();
          });
        }
      });
    }
  };
}
```

### 5.3 Session / Thread ID mapping

The existing `sessions` table in `db.ts` already stores the mapping:

```
sessions.thread_id  →  assistant-ui thread key (UUID)
sessions.session_id →  Codex App Server threadId (e.g. "thread-abc123")
```

`getOrCreateCodexThread()` in the adapter:
1. Looks up `session_id` for the current `thread_id` in the sessions table
2. If found, calls `codex_send_turn` with the existing `codexThreadId` — the App Server already has the full conversation history in that thread
3. If not found, calls `codex_start_thread` → persists returned `threadId` to sessions table

No new migrations needed. The existing `session_id` column serves the same purpose.

### 5.4 Agent selector — `RuntimeProvider.tsx`

Add an `activeAgent` state (initially read from app settings / localStorage):

```typescript
const [activeAgent, setActiveAgent] = useState<"claude" | "codex">("claude");

function useRuntimeHook() {
  const adapter = useMemo(
    () => activeAgent === "codex" ? createCodexAdapter() : createClaudeAdapter(),
    [activeAgent]
  );
  return useLocalRuntime(adapter);
}
```

The selector UI (a simple shadcn `DropdownMenu` or `Tabs` in the sidebar header) calls `setActiveAgent`. Switching agents does not affect existing threads — each thread's sessions table record determines which Codex/Claude session to resume.

### 5.5 Tool approval UI — `approval-banner.tsx`

When `ApprovalNeeded` events arrive, they push into a Zustand store. The `ApprovalBanner` component (rendered at the root level, above the thread list) renders the top pending approval as a dismissible banner with **Allow** / **Deny** buttons:

```typescript
function ApprovalBanner() {
  const pending = useCodexApprovalStore(s => s.pending[0]);
  if (!pending) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 ...">
      <p>Codex wants to run: <code>{pending.command}</code></p>
      <Button onClick={() => approve(pending.approval_id, true)}>Allow</Button>
      <Button onClick={() => approve(pending.approval_id, false)}>Deny</Button>
    </div>
  );
}

async function approve(approvalId: string, allow: boolean) {
  await invoke("codex_approve_tool", { approvalId, allow });
  codexApprovalStore.getState().dismiss(approvalId);
}
```

### 5.6 `codex-tool-display.tsx`

Mirrors `claude-tool-display.tsx` but maps Codex's `item.type` values:

| App Server item type  | Display component                         |
|-----------------------|-------------------------------------------|
| `file_change`         | Collapsible diff view (path + diff)       |
| `command_execution`   | Terminal block (command + output)         |
| `web_search`          | Search result card (query + sources)      |
| `plan_update`         | Collapsible plan text                     |
| `mcp_tool_call`       | Tool name + arguments + result            |

---

## 6. Capabilities (`default.json`)

Add `codex` alongside the existing Claude entries in both `shell:allow-spawn` and `shell:allow-execute`:

```jsonc
{
  "name": "codex",
  "cmd": "codex",
  "args": true
}
```

Note: the App Server process is spawned from Rust via `tokio::process::Command`, which is not gated by the `default.json` shell permissions (those only apply to the webview's use of the shell plugin). The `default.json` entry is needed only if the TypeScript layer ever spawns `codex` directly (e.g., for `codex login` in the auth flow — see §7).

---

## 7. Authentication

The Codex App Server exposes its auth state via the `account/read` request and `account/updated` push notifications. No new OAuth implementation is needed in Pluribus.

### Flow

1. **Happy path**: The user has already run `codex login` in their terminal. Auth tokens are in `~/.codex/auth.json`. When `CodexService::start()` spawns the App Server, it reads those tokens automatically. `account/updated` fires with `authMode: "chatgpt_oauth"`.

2. **Not authenticated**: `account/updated` fires with `authMode: "unauthenticated"`. The frontend (via `codex_get_auth_status`) detects this and shows a banner: *"Run `codex login` in your terminal to connect your ChatGPT account."*

3. **API key path**: User can enter an `OPENAI_API_KEY` in settings. The `CodexService::start()` injects it as an env var when spawning the App Server:
   ```rust
   Command::new("codex")
       .arg("app-server")
       .env("OPENAI_API_KEY", api_key)
       ...
   ```

4. **Device auth** (future): `codex login --device-auth` prints a code + URL the user enters in a browser. The auth result lands in `~/.codex/auth.json` and `account/updated` fires. Pluribus could surface the device code in a modal rather than requiring a terminal, by spawning `codex login --device-auth` and reading its stdout.

### What does NOT need building

- No OAuth callback server
- No token storage (Codex CLI manages `~/.codex/auth.json`)
- No token refresh logic (handled by the App Server process)
- No PKCE implementation

---

## 8. New Cargo Dependencies

```toml
[dependencies]
# existing
tauri       = { version = "2", features = [] }
serde       = { version = "1", features = ["derive"] }
serde_json  = "1"
tauri-plugin-shell = "2"
tauri-plugin-sql   = { version = "2", features = ["sqlite"] }
tauri-plugin-dialog = "2"

# new
tokio = { version = "1", features = ["full"] }
uuid  = { version = "1", features = ["v4"] }
```

`tokio` is already present transitively through Tauri, but needs to be explicit for direct use in service code. No `agent-client-protocol` crate yet — that comes with the ACP bridge.

---

## 9. What Does Not Change

| File | Status |
|------|--------|
| `src/lib/claude-adapter.ts` | **Unchanged** — Claude integration is untouched |
| `src/lib/db.ts` | **Unchanged** — sessions table already fits |
| `src/lib/sqlite-thread-list-adapter.ts` | **Unchanged** |
| `src/lib/sqlite-thread-history-adapter.tsx` | **Unchanged** |
| `src/components/ThreadWorkspace.tsx` | **Unchanged** |
| `src/components/assistant-ui/thread.tsx` | **Unchanged** |
| `src/components/assistant-ui/claude-tool-display.tsx` | **Unchanged** |
| `src-tauri/migrations/` | **Unchanged** — no new schema needed |

---

## 10. ACP Future Path (Design Notes — Not in This Feature's Scope)

This section is intentionally part of the design document to ensure the architecture built now does not need to be reworked when ACP agents (Claude Code, Gemini CLI, etc.) are added.

### The vision

```
AgentBridge (TypeScript interface)
  ├── CodexAppServerAdapter   ← built in this feature
  ├── ACPBridgeAdapter        ← future (Claude Code, Gemini CLI, OpenCode, ...)
  └── DirectAPIAdapter        ← existing Claude HTTP adapter (chat-only turns)
```

The `AgentBridge` interface (a thin TypeScript discriminated union of adapter creators) lives in `src/lib/agent-bridge.ts`. The `RuntimeProvider` selects an implementation based on the active agent setting. The frontend (assistant-ui, thread UI, tool display) never speaks to a specific adapter directly.

### ACP in the Rust backend

When `ACPBridgeAdapter` is added:

1. Add `agent-client-protocol = "0.x"` to `Cargo.toml`
2. Create `src-tauri/src/acp/service.rs` implementing the `Client` trait from the crate
3. Spawn the target agent (e.g., `claude --acp`, `gemini-cli --acp`) via `tokio::process::Command`
4. `ClientSideConnection::new(your_client_impl, stdout, stdin)` handles all protocol framing
5. The ACP `session/update` events are mapped to the same `AgentEvent` enum already used by the App Server — the frontend emits the same `"agent:event"` Tauri events

Because `AgentEvent` is already defined in `types.rs` in a way that captures all meaningful content types (text deltas, tool calls, approvals, auth state), the frontend adapter code for ACP would be nearly identical to `codex-adapter.ts`.

### Dual-model conversation pattern

The user noted that "conversation turns can be a different model." The architecture supports this cleanly:

- **Conversation mode**: `DirectAPIAdapter` — calls Claude API directly over HTTP (fast, cheap, no subprocess). Handles pure Q&A, code explanation, planning discussion.
- **Coding agent mode**: `CodexAppServerAdapter` or `ACPBridgeAdapter` — handles turns that require file access, shell execution, multi-step code changes.

A mode toggle in the composer bar (or auto-detection via intent classification) routes the turn to the appropriate adapter. Because both implement `ChatModelAdapter`, `useLocalRuntime` doesn't need to know which is active. The thread history is unified — all turns, regardless of adapter, land in the same SQLite message history.

---

## 11. File Change Summary

### New files
| Path | Description |
|------|-------------|
| `src-tauri/src/codex/mod.rs` | Module root |
| `src-tauri/src/codex/service.rs` | `CodexService` — process mgmt + JSON-RPC dispatcher |
| `src-tauri/src/codex/commands.rs` | Tauri command handlers |
| `src-tauri/src/codex/types.rs` | Rust types: `AgentEvent`, `Usage`, protocol messages |
| `src/lib/codex-adapter.ts` | `ChatModelAdapter` implementation (Tauri IPC) |
| `src/lib/codex-approval-store.ts` | Zustand store for pending approval requests |
| `src/components/assistant-ui/codex-tool-display.tsx` | Tool item renderers for App Server item types |
| `src/components/assistant-ui/approval-banner.tsx` | Floating approval request UI |

### Modified files
| Path | Change |
|------|--------|
| `src-tauri/src/lib.rs` | Register `CodexService` state, add commands to handler |
| `src-tauri/Cargo.toml` | Add `tokio`, `uuid` |
| `src-tauri/capabilities/default.json` | Add `codex` to shell allow-list |
| `src/components/RuntimeProvider.tsx` | Add agent selector state, mount correct adapter |

---

## 12. Open Questions (Deferred to Implementation)

1. **`codex app-server` init handshake** — The App Server README mentions an initialization sequence. The exact `codex/initialize` payload needs to be confirmed from the live binary before implementation. Test with `codex app-server --listen stdio://` manually first.

2. **Thread model on app restart** — When the app restarts, existing Codex `threadId`s in the sessions table may or may not be resumable by a new App Server instance. This needs testing; fallback is to start a fresh thread and pass prior messages as context.

3. **App Server binary path** — `codex app-server` assumes `codex` is on PATH. The Rust service should check for the binary on startup and surface a clear error if not found, rather than failing silently.

4. **Multiple workspaces** — If the user has two threads in different workspace directories, the App Server's `cwd` is set per-turn via the `turn/start` params. This should work without needing separate App Server instances, but needs verification.
