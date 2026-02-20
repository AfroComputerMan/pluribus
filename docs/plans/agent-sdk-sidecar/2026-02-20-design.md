# Agent SDK Sidecar Integration — Design

**Date:** 2026-02-20
**Status:** Approved
**Scope:** Personal use only (single-user desktop app)

---

## Background & Motivation

Pluribus currently drives Claude via a hand-rolled shell adapter (`src/lib/claude-adapter.ts`, ~1900 lines) that:
- Spawns `sh -c "claude ..."` per query via `@tauri-apps/plugin-shell`
- Manually parses the raw Claude CLI JSON event stream (~200-line custom parser)
- Manages session retry logic (resume → session-id → fresh) with an in-memory Map
- Uses a FIFO waiter queue with a 60-second timeout to serialize concurrent thread access

The Anthropic Agent SDK (`@anthropic-ai/claude-agent-sdk`) provides all of this as a typed TypeScript API. This design adds a second adapter backed by the Agent SDK, running as a long-lived Bun sidecar, with a global toggle to switch between the two.

### Why a sidecar?

The Agent SDK is a Node.js library that needs `child_process` and other native APIs. The Tauri webview is a browser context — no native APIs. A sidecar bridges this: a Bun process (bundled into the `.app`) that uses the SDK and communicates with the frontend over NDJSON on stdin/stdout.

### Authentication

For personal use, the sidecar inherits the system environment. If `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` is set (as it would be for any developer who has `claude` working in their terminal), the sidecar picks it up automatically. No in-app credential management needed.

> **Policy note (as of Feb 2026):** Anthropic prohibits use of Pro/Max OAuth tokens in distributed third-party apps. For personal-use-only builds, environment-inherited auth is fine. For any distributed version, use an API key from the Anthropic Console instead.

---

## Architecture Overview

```
App Startup
  └─ RuntimeProvider reads SQLite global_settings: adapter_type = 'shell' | 'agent-sdk'
       │
       ├─ 'shell'      → createClaudeAdapter()        (existing, unchanged)
       │                   └─ Command.create("sh") → Claude CLI subprocess per query
       │
       └─ 'agent-sdk'  → createAgentSdkAdapter()      (new)
                           └─ Command.sidecar("agent-sdk-bridge")  [spawned ONCE, lives forever]
                                └─ Bun + @anthropic-ai/claude-agent-sdk
                                      └─ Claude CLI subprocess (SDK manages lifecycle)

Both adapters implement: ChatModelAdapter.run(options) → AsyncGenerator<RunResult>
Both persist: sessionId to SQLite after each completed turn
Both render: via the same assistant-ui runtime + claude-tool-display.tsx
```

**What does NOT change:**
- `assistant-ui` runtime, thread list adapter, thread history adapter
- `claude-tool-display.tsx` (tool call content shape is the same through both paths)
- All UI components and layout
- Session ID storage schema in SQLite
- `settings-overlay.tsx` MCP / Skills / Permissions / Commands tabs

---

## Comparison: Shell Adapter vs Agent SDK Adapter

| | Shell Adapter | Agent SDK Adapter |
|---|---|---|
| **Process per query** | `sh -c "claude ..."` spawned fresh | Message written to long-running sidecar stdin |
| **Startup cost** | Process spawn per query | One-time sidecar spawn at app start |
| **Event parsing** | ~200 lines custom NDJSON parser | SDK emits typed `SDKMessage` objects |
| **Session management** | Manual retry: resume → session-id → fresh | `options.resume = sessionId`; SDK handles staleness |
| **Abort** | `child.kill()` | `{ type:"interrupt" }` message → AbortController in sidecar |
| **Auth** | System env → Claude CLI | System env → Agent SDK → Claude CLI |
| **Thread serialization** | FIFO waiter queue + 60s timeout in adapter | Lightweight per-threadKey mutex in sidecar |
| **DevPanel events** | Raw stream events (`ClaudeStreamEvent` union) | Typed `SDKMessage` objects (re-mapped to existing categories) |
| **New deps (main app)** | None | None — SDK is sidecar-only |
| **New deps (sidecar)** | N/A | `@anthropic-ai/claude-agent-sdk` |
| **Agentic tools** | Full (Bash, Read, Write, Glob, Grep, …) | Full (same Claude Code tools via SDK) |
| **Shell security** | `sh -c` wrapper (Known Issue in CLAUDE.md) | Resolved — SDK invokes Claude CLI directly |

---

## Section 1 — Sidecar: Build and Bundle

### Directory layout

```
sidecar/
  agent-sdk-bridge/
    index.ts          ← Bun script (the entire sidecar implementation)
    package.json      ← { "dependencies": { "@anthropic-ai/claude-agent-sdk": "latest" } }

src-tauri/
  binaries/           ← compiled binary (gitignored — built during CI/local build)
    agent-sdk-bridge-aarch64-apple-darwin
    agent-sdk-bridge-x86_64-apple-darwin
    agent-sdk-bridge-x86_64-unknown-linux-gnu
    agent-sdk-bridge-x86_64-pc-windows-msvc.exe
```

### Build command

```bash
# From project root — compile sidecar to a self-contained binary
bun build --compile sidecar/agent-sdk-bridge/index.ts \
  --outfile src-tauri/binaries/agent-sdk-bridge
```

Add this to `package.json` scripts:

```json
"build:sidecar": "bun build --compile sidecar/agent-sdk-bridge/index.ts --outfile src-tauri/binaries/agent-sdk-bridge",
"build": "bun run build:sidecar && tsc && vite build"
```

### `tauri.conf.json` addition

```json
"bundle": {
  "externalBin": ["binaries/agent-sdk-bridge"],
  ...
}
```

Tauri automatically appends the target triple suffix (e.g. `-aarch64-apple-darwin`) when resolving the binary at runtime.

### `capabilities/default.json` addition

```json
{
  "identifier": "shell:allow-spawn",
  "allow": [
    { "name": "agent-sdk-bridge", "sidecar": true }
  ]
}
```

---

## Section 2 — IPC Protocol (NDJSON over stdin/stdout)

Every message is a single JSON object on one line (`\n` terminated). The sidecar reads stdin line-by-line; the adapter reads stdout line-by-line.

### Frontend → Sidecar (stdin)

```typescript
type SidecarInbound =
  | {
      type: "query";
      id: string;          // UUID — correlates all outbound events for this query
      prompt: string;
      sessionId?: string;  // undefined = new session
      model?: string;      // e.g. "claude-opus-4-6"
      cwd: string;         // working directory for the agent
      maxTurns?: number;
    }
  | { type: "interrupt"; queryId: string }
  | { type: "ping" };
```

### Sidecar → Frontend (stdout)

```typescript
type SidecarOutbound =
  | { type: "pong" }
  | { type: "message"; queryId: string; message: SDKMessage }   // one per SDK event
  | { type: "done";    queryId: string; sessionId: string; costUsd: number }
  | { type: "error";   queryId: string; error: string };
```

The `id` / `queryId` field multiplexes multiple in-flight queries on one channel without collisions. In practice queries are serialized per thread, but the correlation ID is included for correctness.

### Sidecar internals (`sidecar/agent-sdk-bridge/index.ts`)

```
startup:
  - Set up readline on process.stdin
  - For each line: parse JSON → dispatch by type

on "query":
  - Create AbortController, store as activeQueries.get(id)
  - Call: for await (const msg of query({ prompt, options: { resume: sessionId, model, cwd, ... }, abortController }))
  - For each SDKMessage: write { type:"message", queryId: id, message: msg } to stdout
  - On generator done: write { type:"done", queryId, sessionId, costUsd }
  - On error: write { type:"error", queryId, error: err.message }

on "interrupt":
  - activeQueries.get(queryId)?.abort()

on "ping":
  - write { type:"pong" }
```

The sidecar uses a simple `Map<string, AbortController>` for active queries and cleans up on done/error.

---

## Section 3 — `agent-sdk-adapter.ts`

New file: `src/lib/agent-sdk-adapter.ts`

Implements `ChatModelAdapter` (same interface as `claude-adapter.ts`):

```typescript
export function createAgentSdkAdapter(): ChatModelAdapter {
  // Singleton sidecar process — started lazily, restarted on crash
  const sidecar = new AgentSdkSidecar();

  return {
    async *run(options) {
      // 1. Extract prompt (same extractUserPrompt logic as claude-adapter.ts)
      const prompt = extractUserPrompt(options.messages);

      // 2. Look up threadKey + sessionId from SQLite
      const threadKey = options.threadId ?? GLOBAL_THREAD_KEY;
      const sessionId = await db.sessions.getForThread(threadKey);

      // 3. Acquire per-thread lock (lightweight mutex, not FIFO queue)
      await sidecar.acquireLock(threadKey);
      try {
        // 4. Send query to sidecar
        const queryId = crypto.randomUUID();
        sidecar.send({ type: "query", id: queryId, prompt, sessionId, model, cwd });

        // 5. Stream response
        for await (const event of sidecar.eventsFor(queryId, options.abortSignal)) {
          if (event.type === "message") {
            yield* mapSdkMessageToContentParts(event.message);  // → text/tool_call parts
            emitToDevPanel(event.message, threadKey);
          } else if (event.type === "done") {
            await db.sessions.saveForThread(threadKey, event.sessionId);
          }
        }
      } finally {
        sidecar.releaseLock(threadKey);
      }
    }
  };
}
```

### Key helper: `mapSdkMessageToContentParts`

Maps `SDKAssistantMessage.message.content[]` to assistant-ui content parts:
- `{ type: "text" }` → `AppendTextContentPart`
- `{ type: "tool_use" }` → `AppendToolCallContentPart` (same shape as current adapter)
- `{ type: "thinking" }` → `AppendTextContentPart` (or a dedicated thinking part)

The tool call shape is identical to what `claude-tool-display.tsx` already expects, so no UI changes are needed for tool rendering.

### `AgentSdkSidecar` class

Internal class managing:
- `Command.sidecar("agent-sdk-bridge")` lifecycle (lazy start, crash recovery)
- Line-buffered stdout reader → `EventEmitter` keyed by `queryId`
- Stdin write queue
- Per-thread mutex (`Map<string, Promise<void>>`)

---

## Section 4 — Settings Integration

### Database: `global_settings` table

New migration (`007_global_settings.sql`):

```sql
CREATE TABLE IF NOT EXISTS global_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

New DB methods:
- `db.globalSettings.get(key): Promise<string | null>`
- `db.globalSettings.set(key, value): Promise<void>`

### `RuntimeProvider.tsx` change

```typescript
function useAdapterType() {
  const [adapterType, setAdapterType] = useState<'shell' | 'agent-sdk'>('shell');
  useEffect(() => {
    db.globalSettings.get('adapter_type').then(v => {
      if (v === 'agent-sdk') setAdapterType('agent-sdk');
    });
  }, []);
  return adapterType;
}

function useRuntimeHook(adapterType: 'shell' | 'agent-sdk') {
  const adapter = useMemo(
    () => adapterType === 'agent-sdk' ? createAgentSdkAdapter() : createClaudeAdapter(),
    [adapterType]
  );
  return useLocalRuntime(adapter);
}
```

> The adapter is created once. Changing the setting writes to SQLite and shows a "Restart to apply" banner — no hot-switching needed. This avoids complexity around remounting the runtime.

### `settings-overlay.tsx` change

A new **"Engine"** row is added in the header area (always visible, not tab-scoped since it's global-only):

```
┌─ Settings ────────────────────────────────────────┐
│ ← Settings  [Global ▼]               [read-only]  │
│                                                    │
│ Engine   ○ Shell (Claude CLI)  ● Agent SDK         │  ← new row
│          Will take effect after restart.           │
│                                                    │
├─ MCP Servers │ Skills │ Permissions │ Commands ────┤
```

The toggle calls `db.globalSettings.set('adapter_type', value)` immediately and shows an inline restart note if the value changed.

---

## Section 5 — DevPanel Adaptation

The `ClaudeDevEvent` interface gains an optional field:

```typescript
export interface ClaudeDevEvent {
  id: string;
  at: number;
  threadKey: string;
  raw: string;
  parsed: ClaudeStreamEvent;
  sdkMessage?: SDKMessage;   // ← new: present only in Agent SDK mode
  category: ClaudeDevEventCategory;
}
```

When `sdkMessage` is present, the DevPanel renders it with SDK-native type labels instead of raw stream event types.

### Category mapping for SDK messages

| `SDKMessage` type/subtype | Category |
|---|---|
| `system` → `init` | `other` |
| `assistant` | `messages` |
| `user` | `messages` |
| `result` → `success` | `usage` (shows `total_cost_usd`, token counts) |
| `result` → `error_*` | `other` |

The DevPanel renders SDK messages with a distinct visual treatment (e.g. a small "SDK" badge on event rows) so it's clear which mode is active.

---

## Files Affected

### New files
| File | Purpose |
|---|---|
| `sidecar/agent-sdk-bridge/index.ts` | Bun sidecar script |
| `sidecar/agent-sdk-bridge/package.json` | Sidecar dependencies |
| `src/lib/agent-sdk-adapter.ts` | Frontend adapter |
| `src-tauri/migrations/007_global_settings.sql` | DB migration |
| `src-tauri/binaries/.gitkeep` | Keeps binaries dir in git |

### Modified files
| File | Change |
|---|---|
| `src/components/RuntimeProvider.tsx` | Read `adapter_type` setting, conditionally instantiate adapter |
| `src/components/settings-overlay.tsx` | Add Engine toggle row in header |
| `src/lib/db.ts` | Add `globalSettings` methods; register migration |
| `src-tauri/src/lib.rs` | Register migration 007 |
| `src-tauri/tauri.conf.json` | Add `bundle.externalBin` |
| `src-tauri/capabilities/default.json` | Add sidecar spawn permission |
| `src/components/DevPanel.tsx` | Add `sdkMessage` rendering branch |
| `package.json` | Add `build:sidecar` script |

---

## Open Questions / Future Work

- **Workspaces:** The `cwd` sent to the sidecar should respect the active workspace, same as the shell adapter. The `agent-sdk-adapter.ts` should read `cwd` from thread metadata.
- **MCP servers & skills:** The Agent SDK supports `mcpServers` and `settingSources: ['project']` options. A future pass could forward the app's MCP config to the sidecar query, unifying the two adapters' config surfaces.
- **Permission prompts:** The SDK's `PermissionRequest` hook can be wired to the existing Pluribus permission UI in a future pass.
- **Binary size:** `bun build --compile` produces a self-contained binary (~50–80 MB including the Bun runtime). This is acceptable for a personal desktop app.
