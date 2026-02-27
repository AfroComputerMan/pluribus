# Research: OpenAI Codex Integration into Pluribus
**Date**: 2026-02-20
**Depth**: Deep
**Sources**: OpenAI Developer Docs, GitHub openai/codex, InfoQ, Dev.to, npm registry

> **Design doc written**: See `docs/plans/2026-02-20-codex-app-server-design.md` for the
> approved architecture. The initial research below led to a broader brainstorming session
> whose conclusions (App Server via Rust backend + ACP future path) are captured there.

## Additional Findings from Brainstorming Session

### ACP (Agent Client Protocol) — Zed Industries

ACP is the open JSON-RPC standard for connecting coding agents to editors/IDEs. It is to
coding agents what LSP is to language servers — implement the client once, every compliant
agent is available. The official Rust crate (`agent-client-protocol`) powers Zed's own
integration and is the intended foundation for Pluribus's future multi-agent support.

**ACP registry agents (as of Feb 2026)**: Claude Code, Codex CLI, Gemini CLI, GitHub
Copilot CLI, OpenCode.

**Why not ACP for this feature**: ACP's session model is simpler than the Codex App
Server (no per-item streaming, no approval request flow, no `account/updated` push). For
the first Codex integration, the App Server gives more control. ACP is the right layer
when adding Claude Code and other agents later.

### App Server vs `codex exec --json` vs `@openai/codex-sdk`

The initial research recommended `codex exec --json` as the simplest path. After
brainstorming, the decision shifted to the App Server for these reasons:

- **Bidirectionality**: The App Server can pause a turn and request tool approval from the
  client. `codex exec` is fire-and-forget.
- **Long-lived threads**: One process manages multiple conversation threads. `codex exec`
  spawns per invocation.
- **`@openai/codex-sdk`**: Requires Node.js 18+, cannot run in Tauri's webview, and would
  need a sidecar. It wraps subprocess management that Rust does better natively.

### Rust backend decision

The App Server client lives in Rust (`src-tauri/src/codex/`) using `tokio::process::Command`
for bidirectional stdio. Key advantages over TypeScript shell plugin:
- True concurrent read/write via separate Tokio tasks (necessary for approval flow)
- Long-lived `State<T>` for the `codex app-server` process
- Direct path to `cargo add agent-client-protocol` for ACP later
- Process cleanup guaranteed via `Drop` / `kill_on_drop`

---

---

## Executive Summary

OpenAI Codex CLI is a viable **first-class alternative agent** to Claude Code in Pluribus. It is architecturally very similar to the Claude CLI integration — both are terminal-first coding agents that stream structured JSON events. The integration requires:

1. **The `codex` binary must be installed** — there is no pure-library approach that avoids a subprocess. The TypeScript SDK (`@openai/codex-sdk`) abstracts subprocess management but still requires the binary.
2. **The integration pattern mirrors your existing `claude-adapter.ts`** almost exactly — you'd create a `codex-adapter.ts` implementing the same `ChatModelAdapter` interface.
3. **Minimal component changes required** — the existing assistant-ui runtime, thread list, and history adapters can all be reused. The only new components needed are the adapter itself and Tauri capability permissions.
4. **A cleaner event format** — Codex's JSONL events are more standardized than Claude's proprietary format, which may simplify the adapter.

---

## What Is Codex CLI?

OpenAI Codex CLI (`@openai/codex`) is OpenAI's open-source, terminal-first coding agent (released 2025, actively developed). It is built in Rust for speed, available on macOS and Linux. It can read, edit, and run code in a project directory.

- **GitHub**: `openai/codex` (~61k stars as of Feb 2026)
- **Install**: `npm i -g @openai/codex`
- **Model**: GPT-5-Codex (via ChatGPT subscription) or any OpenAI API model
- **Authentication**: ChatGPT OAuth or OpenAI API key

### How It Compares to Claude Code

| Feature | Claude Code | Codex CLI |
|---|---|---|
| Runtime | Node.js | Rust binary |
| Event format | Proprietary JSON stream | JSONL (standardized event types) |
| Auth | Claude subscription / API key | ChatGPT subscription / OpenAI API key |
| Session resume | `--resume <file>` / `--session-id` | `codex exec resume [SESSION_ID]` |
| Non-interactive mode | `--output-format stream-json` | `codex exec --json "prompt"` |
| MCP server mode | `claude --mcp-server` | `codex mcp-server` |
| Open source | Partial | Yes (full Rust core) |

---

## Integration Options (Ranked by Fit for Pluribus)

### Option 1: `codex exec --json` Subprocess (Recommended — Closest to Current Pattern)

**How it works**: Spawn `codex exec --json "user prompt"` as a subprocess via Tauri's shell plugin. It streams JSONL events to stdout.

```
codex exec --json "Fix the failing tests"
```

**Event stream example**:
```jsonl
{"type":"thread.started","threadId":"..."}
{"type":"turn.started","turnId":"..."}
{"type":"item.agentMessage.delta","delta":"I'll start by looking at..."}
{"type":"item.completed","item":{"type":"file_change","path":"src/foo.ts",...}}
{"type":"turn.completed","usage":{"input_tokens":1200,"output_tokens":430}}
```

**Event types include**:
- `thread.started`, `turn.started`, `turn.completed`, `turn.failed`
- `item.*` — agent messages, reasoning, command executions, file changes, MCP tool calls, web searches, plan updates

**Session resume**: `codex exec resume SESSION_ID "follow-up prompt"`

**Pros**:
- Identical architecture to current Claude integration
- No new dependencies in the webview
- Works with existing Tauri shell permissions pattern

**Cons**:
- Requires `codex` binary in PATH
- Same shell security concerns as current `claude-stream-sh` wrapper

---

### Option 2: `@openai/codex-sdk` TypeScript SDK

**How it works**: A TypeScript library (`@openai/codex-sdk`) that manages the subprocess internally and provides a clean async API.

```typescript
import { Codex } from "@openai/codex-sdk";

const codex = new Codex({ env: { PATH: "/usr/local/bin" } });
const thread = codex.startThread({ workingDirectory: "/path/to/project" });

// Blocking
const result = await thread.run("Fix the failing tests");

// Streaming (returns async generator)
const { events } = await thread.runStreamed("Fix the failing tests");
for await (const event of events) {
  switch (event.type) {
    case "item.completed": console.log(event.item); break;
    case "turn.completed": console.log(event.usage); break;
  }
}

// Resume previous thread
const thread2 = codex.resumeThread(savedThreadId);
```

**Critical constraint**: Requires Node.js 18+. The Tauri webview is **not** a Node.js environment — this SDK cannot be used directly in `src/`.

**Workaround options**:
- Use it in a Tauri **sidecar** (a separate Node.js process spawned by Rust)
- Use it in a separate Tauri **plugin** written in Node.js
- **Skip it and use Option 1** — it's simpler and the SDK just wraps the same subprocess anyway

**Verdict**: Not directly usable in Pluribus's current webview architecture without significant sidecar work. Option 1 achieves the same result more simply.

---

### Option 3: Codex App Server (JSON-RPC over stdio)

**How it works**: Run `codex app-server` as a long-lived process. Communicate via bidirectional JSON-RPC lite (JSONL over stdin/stdout). This is the protocol the VS Code extension, TUI, and web app all use.

```
codex app-server --listen stdio://
```

**Protocol**:
```jsonl
// Client → Server (request)
{"method":"thread/start","id":1,"params":{"model":"gpt-5-codex-high"}}
// Server → Client (response)
{"id":1,"result":{"threadId":"abc123"}}

// Client → Server (start turn)
{"method":"turn/start","id":2,"params":{"threadId":"abc123","input":"Fix tests"}}
// Server → Client (streaming notifications, no id)
{"method":"item/agentMessage/delta","params":{"delta":"I'll look at..."}}
{"method":"turn/completed","params":{"threadId":"abc123","usage":{...}}}
```

**Pros**:
- Supports multiple concurrent threads in one process
- Bidirectional — supports tool approval flows (server asks client "allow this shell command?")
- More stable interface than raw exec

**Cons**:
- More complex protocol to implement
- Requires managing a long-lived process in Tauri's Rust backend
- Overkill for current Pluribus needs

**Verdict**: Best long-term architecture if you want full tool approval UI. Too complex for initial integration.

---

### Option 4: Codex as MCP Server

```
codex mcp-server
```

Runs Codex as an MCP server over stdio. "Useful when another agent consumes Codex." Experimental. Not the right fit for a chat interface.

---

## Authentication

Two authentication methods:

### A. ChatGPT OAuth (recommended for end users)
```bash
codex login          # opens browser
# Creates ~/.codex/auth.json with access tokens
```
- Requires ChatGPT Plus/Pro/Business/Enterprise subscription
- Auth cached in `~/.codex/auth.json`
- Can be copied to headless machines via SSH

### B. OpenAI API Key
```bash
export OPENAI_API_KEY="sk-..."
# Or: export CODEX_API_KEY="sk-..."
# Or: printenv OPENAI_API_KEY | codex login --with-api-key
```
- Billed at standard OpenAI API rates
- Works without ChatGPT subscription
- In Tauri: inject via `env` parameter in Command, or read from a settings store

**For Pluribus**: The simplest approach is to have the user run `codex login` once in their terminal (ChatGPT OAuth). Auth tokens in `~/.codex/auth.json` persist. Alternatively, let the user enter their OpenAI API key in app settings and inject it as `CODEX_API_KEY` when spawning the subprocess.

---

## What Needs to Change in Pluribus

### Must Create / Modify

1. **`src/lib/codex-adapter.ts`** (new file)
   - Implements `ChatModelAdapter` (same interface as `claude-adapter.ts`)
   - Spawns `codex exec --json` via `Command.create("codex", ["exec", "--json", prompt])`
   - Parses JSONL events from stdout → maps to assistant-ui `AppendText`, `AppendToolCall`, etc.
   - Manages sessions via `codex exec resume SESSION_ID`
   - Stores session IDs in SQLite (reuse `db.ts` session infrastructure)

2. **`src-tauri/capabilities/default.json`** (modify)
   - Add `codex` to the list of allowed shell commands alongside existing Claude permissions

3. **`src/components/RuntimeProvider.tsx`** (small change)
   - Accept an `agent` prop or read from settings to select which adapter to use
   - Could be as simple as `agent === "codex" ? new CodexAdapter() : new ClaudeAdapter()`

### Optionally Create

4. **`src/components/assistant-ui/codex-tool-display.tsx`** (new file)
   - Similar to `claude-tool-display.tsx` but maps Codex's `item.*` event types
   - Codex events have different item type names but carry similar semantics (file changes, command executions, web searches)

5. **Agent selection UI** (new component)
   - Dropdown or settings panel to switch between Claude and Codex
   - Could use shadcn/ui `Select` component

### Do Not Need to Change

- `src/lib/db.ts` — schema works for any agent; session storage is generic
- `src/lib/sqlite-thread-list-adapter.ts` — thread list is agent-agnostic
- `src/lib/sqlite-thread-history-adapter.tsx` — message history is agent-agnostic
- `src/components/ThreadWorkspace.tsx` — layout is unchanged
- `src/components/assistant-ui/thread.tsx` — chat UI is unchanged (assistant-ui handles rendering)

---

## Codex Event Format vs Claude Event Format

This is critical for adapter implementation:

### Claude CLI events (current format)
```json
{"type":"assistant","message":{"content":[{"type":"text","text":"..."}]}}
{"type":"tool_use","name":"str_replace_based_edit_tool","input":{...}}
{"type":"result","subtype":"success","result":"..."}
```

### Codex CLI events (`codex exec --json`)
```json
{"type":"thread.started","threadId":"abc"}
{"type":"turn.started","turnId":"xyz","threadId":"abc"}
{"type":"item.agentMessage.delta","delta":"Let me look at...","threadId":"abc"}
{"type":"item.completed","item":{"type":"agent_message","content":"..."},"threadId":"abc"}
{"type":"item.completed","item":{"type":"command_execution","command":"cargo test","output":"..."}}
{"type":"item.completed","item":{"type":"file_change","path":"src/foo.ts","diff":"..."}}
{"type":"turn.completed","usage":{"input_tokens":1200,"output_tokens":430}}
```

Codex's format is more structured and standardized. The adapter would be somewhat simpler to write since event types are explicit and hierarchical.

---

## Complexity Assessment

| Task | Effort | Notes |
|---|---|---|
| Create `codex-adapter.ts` | Medium (1-2 days) | Mirror claude-adapter.ts structure, map different event types |
| Update capabilities | Trivial | Add `codex` to shell allow-list |
| Agent selector UI | Small (2-4 hours) | shadcn Select or radio buttons in settings |
| Codex tool display | Small-Medium | Similar to claude-tool-display.tsx |
| Auth UX | Small | API key field in settings, or just prompt user to run `codex login` |
| Full App Server integration | Large (1 week+) | Only worthwhile if you need tool approval UI |

**Total for first-class Codex integration (Option 1 approach)**: ~2-4 days of focused work

---

## Key Recommendation

**Use `codex exec --json` subprocess approach** (Option 1). It is:
- The most direct parallel to how Claude is integrated today
- Requires no new runtime dependencies in the webview
- Well-documented with stable JSONL event format
- Easily extended to the App Server later if you need bidirectional tool approval flows

**For authentication**, support both:
1. Auto-detect if `~/.codex/auth.json` exists (ChatGPT OAuth already done)
2. Allow OPENAI_API_KEY / CODEX_API_KEY injection from app settings

**You do not need to modify any existing UI components** — the assistant-ui runtime, thread list, history adapters, and layout components are all agent-agnostic. A new adapter + capabilities update is the minimum viable integration.

---

## Sources

1. [OpenAI Codex CLI Docs](https://developers.openai.com/codex/cli/)
2. [Codex SDK Docs](https://developers.openai.com/codex/sdk/)
3. [Codex Auth Docs](https://developers.openai.com/codex/auth/)
4. [Codex Non-Interactive Mode](https://developers.openai.com/codex/noninteractive/)
5. [Codex CLI Reference](https://developers.openai.com/codex/cli/reference/)
6. [Unlocking the Codex Harness (App Server)](https://openai.com/index/unlocking-the-codex-harness/)
7. [Unrolling the Codex Agent Loop](https://openai.com/index/unrolling-the-codex-agent-loop/)
8. [openai/codex App Server README (GitHub)](https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md)
9. [openai/codex-sdk TypeScript README (GitHub)](https://github.com/openai/codex/blob/main/sdk/typescript/README.md)
10. [OpenAI Codex as Native Agent in TypeScript (Dev.to)](https://dev.to/kachurun/openai-codex-as-a-native-agent-in-your-typescript-nodejs-app-kii)
11. [@openai/codex-sdk on npm](https://npmjs.com/package/@openai/codex-sdk)
12. [InfoQ: Codex App Server Architecture](https://www.infoq.com/news/2026/02/opanai-codex-app-server/)
13. [OpenCode vs Codex CLI Comparison](https://www.morphllm.com/comparisons/opencode-vs-codex)
