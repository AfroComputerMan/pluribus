# How Applications Integrate with Claude Code CLI

## Research Report -- February 8, 2026

---

## Executive Summary

Applications like OpenCode, Conductor, and Pencil each take a **fundamentally different approach** to integrating with Claude Code. There is no single "wrapper" pattern -- instead, the ecosystem has evolved three distinct architectures:

| App | Integration Approach | Key Mechanism |
|-----|---------------------|---------------|
| **OpenCode** | Independent agent -- does NOT wrap Claude Code | Calls AI provider APIs directly (Claude API, OpenAI, etc.) |
| **Conductor** | Spawns multiple Claude Code CLI instances in parallel | Subprocess spawning + git worktrees for isolation |
| **Pencil** | MCP context provider for Claude Code | Exposes design data via MCP server that Claude Code reads |

For your Tauri app, the most practical approach is **spawning Claude Code CLI as a subprocess** using `tauri-plugin-shell`, or using the new **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) as a sidecar process.

---

## 1. The Three Integration Architectures

### Architecture A: Direct API Calls (OpenCode's Approach)

OpenCode does NOT wrap or harness Claude Code at all. It is an **independent, open-source AI coding agent** built by the SST team (now Anomaly Innovations). It calls AI provider APIs directly.

**How OpenCode works:**
- Written in Go with a native terminal-based UI (TUI)
- Calls Claude, OpenAI, Gemini, and 75+ model APIs **directly** using their respective SDKs
- Users bring their own API keys
- Implements its own agentic loop, tool execution, and context management
- Supports the **Agent Client Protocol (ACP)** for editor integration (JetBrains, Zed, Neovim, Emacs)
- Has its own LSP (Language Server Protocol) integration for code intelligence
- Supports MCP servers for extensibility

**Key insight**: OpenCode is a *competitor* to Claude Code, not a wrapper around it. When people compare them, they compare two independent tools that both provide AI-assisted coding in the terminal.

**Stats**: 95k+ GitHub stars, 650+ contributors, 2.5M+ monthly users.

**Source**: [GitHub - sst/opencode](https://github.com/sst/opencode), [InfoQ Article](https://www.infoq.com/news/2026/02/opencode-coding-agent/)

---

### Architecture B: Subprocess Orchestration (Conductor's Approach)

Conductor is the canonical example of a "Claude Code wrapper" / "harness." It spawns actual Claude Code CLI instances as subprocesses.

**How Conductor works:**

1. **Detection**: Requires Claude Code CLI to be installed on the user's system
2. **Git Worktrees**: For each agent task, Conductor creates an independent `git worktree` -- a separate working copy of your repo on a new branch
3. **Subprocess Spawning**: Launches a separate `claude` CLI process for each worktree, using flags like `-p` (print mode) and `--output-format stream-json`
4. **Dashboard**: Provides a visual Mac app where you can see all agents working simultaneously
5. **Review & Merge**: After agents complete their tasks, you review diffs and merge branches back

**Architecture diagram:**

```
+---------------------------+
|  Conductor App (Mac GUI)  |
|                           |
|  Agent 1   Agent 2   ...  |
+----+----------+----------+
     |          |
     v          v
+--------+  +--------+
| claude |  | claude |    <- Separate CLI processes
| -p ... |  | -p ... |
+--------+  +--------+
     |          |
     v          v
+--------+  +--------+
| worktree| | worktree|  <- Isolated git worktrees
| branch-1| | branch-2|
+--------+  +--------+
     |          |
     +----+-----+
          v
    Main Repository
```

**Key CLI flags Conductor uses:**
- `claude -p "task description"` -- non-interactive mode
- `--output-format stream-json` -- structured streaming output
- `--permission-mode bypassPermissions` or `--dangerously-skip-permissions` -- unattended execution
- `--max-budget-usd <amount>` -- cost control per agent
- `--session-id <uuid>` -- session management

**Conductor variants:**
- **[Conductor.build](https://www.conductor.build/)** (by Melty Labs) -- Mac desktop app, visual dashboard
- **[code-conductor](https://github.com/ryanmac/code-conductor)** (by ryanmac) -- GitHub-native orchestration, open-source
- **[claude-conductor](https://github.com/superbasicstudio/claude-conductor)** -- Simple Claude Code framework

**Sources**: [Conductor.build](https://www.conductor.build/), [The New Stack Review](https://thenewstack.io/a-hands-on-review-of-conductor-an-ai-parallel-runner-app/), [Parallel Agent Multiplier Article](https://elite-ai-assisted-coding.dev/p/the-parallel-agent-multiplier-conductor-with-charlie-holtz)

---

### Architecture C: MCP Context Provider (Pencil's Approach)

Pencil takes a completely different approach -- it doesn't wrap or spawn Claude Code. Instead, it **exposes design data to Claude Code via MCP**.

**How Pencil works:**

1. **Design Canvas in IDE**: Pencil is a Figma-like vector design tool that lives inside your IDE (VS Code, Cursor)
2. **Design Files as Code**: Designs are stored as `.pen` files (JSON-based) in your git repository
3. **MCP Server**: Pencil runs an MCP server that gives AI agents (including Claude Code) read/write access to design specifications
4. **AI Generates Code**: When you run Claude Code, it can read Pencil design specs via MCP and generate matching code
5. **Claude Code Required**: Pencil requires Claude Code (or another AI coding tool) to be installed -- it acts as a context source, not a replacement

**Architecture:**

```
+-------------------+     MCP Protocol     +------------------+
| Claude Code CLI   | <------------------> | Pencil MCP Server|
| (or Cursor, etc.) |                      | (design context) |
+-------------------+                      +------------------+
         |                                          |
         v                                          v
    Code Output                              .pen design files
    (React, etc.)                            (in git repo)
```

**Key insight**: Pencil is an *overlay* -- it doesn't generate code itself. All code generation happens on Anthropic's side via Claude Code. Pencil just provides the design context.

**Sources**: [Pencil.dev](https://www.pencil.dev/), [Pencil Documentation](https://docs.pencil.dev/getting-started), [AI Integration Docs](https://docs.pencil.dev/getting-started/ai-integration)

---

## 2. Anthropic's Official Integration Methods

### The Claude Agent SDK (Recommended for New Projects)

As of early 2026, Anthropic renamed the "Claude Code SDK" to the **Claude Agent SDK** and released it as a separate package.

**Package names:**
- TypeScript: `@anthropic-ai/claude-agent-sdk`
- Python: `claude-agent-sdk`

**Key API -- the `query()` function:**

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const message of query({
  prompt: "Find and fix the bug in auth.py",
  options: {
    allowedTools: ["Read", "Edit", "Bash"],
    permissionMode: "bypassPermissions",
    maxTurns: 10,
  }
})) {
  if ("result" in message) console.log(message.result);
}
```

**Features:**
- Built-in tools: Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch
- Session management with `resume` option
- Subagents via the `Task` tool
- MCP server integration
- Hooks for custom behavior at lifecycle events
- Python and TypeScript support

**Important**: The Agent SDK requires Node.js (TypeScript) or Python runtime. It will NOT run in a browser/WebView context.

**Source**: [Agent SDK Documentation](https://platform.claude.com/docs/en/agent-sdk/overview)

### CLI Subprocess Mode (The "Harness" Pattern)

For languages that aren't TypeScript/Python, or for simpler integrations, spawning the CLI directly is the standard approach:

```bash
claude -p "Fix the bug" \
  --output-format stream-json \
  --include-partial-messages \
  --permission-mode bypassPermissions
```

**Stream-JSON event types:**

| Event Type | Description |
|-----------|-------------|
| `system` (subtype: `init`) | Session initialization -- includes session_id, tools, model |
| `content_block_delta` | Partial text tokens (real-time streaming) |
| `assistant` | Complete assistant message with content blocks |
| `tool_result` | Output from a tool execution |
| `result` | Final result with cost, duration, session_id |

**Bidirectional streaming** (for multi-turn chat):
```bash
claude -p --input-format stream-json --output-format stream-json --replay-user-messages
```
Write JSON to stdin, read NDJSON from stdout.

### Anthropic's "Agent Harness" Best Practices

Anthropic published official guidance on building effective harnesses:

1. **Initializer + Worker pattern**: Use one agent to set up the environment, then worker agents for tasks
2. **Progress files**: Maintain `claude-progress.txt` for cross-session memory
3. **Incremental development**: One feature per session to avoid context exhaustion
4. **Clean state transitions**: Every session must leave code in a mergeable state
5. **End-to-end testing**: Use browser automation to verify, not just unit tests

**Source**: [Anthropic Engineering - Effective Harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

---

## 3. How Detection Works

All apps that rely on Claude Code CLI use similar detection strategies:

```typescript
// Strategy 1: PATH lookup
const result = await Command.create('which', ['claude']).execute();
const claudePath = result.stdout.trim(); // e.g., "/home/user/.local/bin/claude"

// Strategy 2: Common install paths
const candidates = [
  `${homedir}/.local/bin/claude`,           // Linux npm global
  `${homedir}/.npm-global/bin/claude`,      // Custom npm prefix
  '/usr/local/bin/claude',                   // macOS
  `${homedir}/AppData/Roaming/npm/claude`,  // Windows
];

// Strategy 3: Version check
const version = await Command.create('claude', ['--version']).execute();
```

---

## 4. Integrating with Your Tauri App (Pluribus)

Your project at `/home/user/projects/pluribus` is a fresh Tauri 2.x + React app. Here's how to connect it to Claude Code.

### Recommended Approach: `tauri-plugin-shell` + CLI Subprocess

This is the simplest and most maintainable approach for a Tauri app.

**Why not the Agent SDK?**
The Agent SDK (`@anthropic-ai/claude-agent-sdk`) requires Node.js `child_process` APIs internally, which are unavailable in Tauri's WebView frontend. You'd need a Node.js sidecar to use it, adding complexity.

**Why the shell plugin?**
`tauri-plugin-shell` lets you spawn `claude` CLI directly from the React frontend, with event-based stdout streaming that maps perfectly to Claude Code's `stream-json` output.

### Required Changes

**1. Install dependencies:**
```bash
# Rust side
cd src-tauri && cargo add tauri-plugin-shell@2

# JavaScript side
bun add @tauri-apps/plugin-shell
```

**2. Register the plugin** in `src-tauri/src/lib.rs`:
```rust
tauri::Builder::default()
    .plugin(tauri_plugin_shell::init())
    // ... existing plugins
```

**3. Configure shell scope** in `src-tauri/tauri.conf.json`:
```json
{
  "plugins": {
    "shell": {
      "scope": [
        { "name": "claude", "cmd": "claude", "args": true },
        { "name": "which", "cmd": "which", "args": ["claude"] }
      ]
    }
  }
}
```

**4. Add permissions** to `src-tauri/capabilities/default.json`:
```json
{
  "permissions": [
    "core:default",
    "opener:default",
    "shell:allow-spawn",
    "shell:allow-execute",
    "shell:allow-stdin-write",
    "shell:allow-kill"
  ]
}
```

**5. React hook for Claude Code** (`src/hooks/useClaude.ts`):
```typescript
import { Command } from '@tauri-apps/plugin-shell';
import { useState, useCallback, useRef } from 'react';

interface ClaudeEvent {
  type: string;
  subtype?: string;
  message?: { content: Array<{ type: string; text?: string }> };
  result?: string;
  cost_usd?: number;
  session_id?: string;
  delta?: { type: string; text: string };
}

export function useClaude() {
  const [messages, setMessages] = useState<Array<{role: string; content: string}>>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [currentResponse, setCurrentResponse] = useState('');
  const childRef = useRef<any>(null);
  const sessionIdRef = useRef<string | null>(null);

  const sendMessage = useCallback(async (prompt: string) => {
    setIsStreaming(true);
    setCurrentResponse('');
    setMessages(prev => [...prev, { role: 'user', content: prompt }]);

    const args = ['-p', prompt, '--output-format', 'stream-json'];
    if (sessionIdRef.current) {
      args.push('--resume', sessionIdRef.current);
    }

    const command = Command.create('claude', args);
    let fullResponse = '';

    command.stdout.on('data', (line: string) => {
      if (!line.trim()) return;
      try {
        const event: ClaudeEvent = JSON.parse(line);
        if (event.type === 'system') {
          sessionIdRef.current = event.session_id ?? null;
        } else if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              fullResponse = block.text;
              setCurrentResponse(fullResponse);
            }
          }
        } else if (event.type === 'result' && event.result) {
          setMessages(prev => [...prev, { role: 'assistant', content: event.result! }]);
          setCurrentResponse('');
        }
      } catch (e) { /* skip unparseable lines */ }
    });

    command.on('close', () => setIsStreaming(false));
    command.on('error', () => setIsStreaming(false));

    childRef.current = await command.spawn();
  }, []);

  const cancel = useCallback(async () => {
    if (childRef.current) {
      await childRef.current.kill();
      setIsStreaming(false);
    }
  }, []);

  return { messages, currentResponse, isStreaming, sendMessage, cancel };
}
```

### Architecture Diagram

```
+--------------------------------------------------+
|  Tauri Window (WebView)                          |
|  React + TypeScript Frontend                     |
|                                                  |
|  Chat UI <--> useClaude hook                     |
|                    |                             |
|                    v                             |
|  @tauri-apps/plugin-shell                        |
|  Command.create('claude', [...args])             |
|  .stdout.on('data', parseNDJSON)                 |
+--------------------------------------------------+
         |  spawn / IPC
         v
+--------------------------------------------------+
|  claude CLI process                              |
|  claude -p "prompt"                              |
|    --output-format stream-json                   |
|                                                  |
|  Emits NDJSON on stdout:                         |
|    {"type":"system","session_id":"..."}           |
|    {"type":"assistant","message":{...}}           |
|    {"type":"result","result":"...","cost_usd":..} |
+--------------------------------------------------+
```

---

## 5. Confidence Assessment

| Finding | Confidence | Notes |
|---------|-----------|-------|
| OpenCode is independent, not a Claude Code wrapper | HIGH | Confirmed via official site, GitHub, multiple sources |
| Conductor uses subprocess spawning + git worktrees | HIGH | Confirmed via official site, reviews, GitHub repos |
| Pencil uses MCP to provide context to Claude Code | HIGH | Confirmed via official docs and multiple reviews |
| Claude Agent SDK is the official programmatic API | HIGH | Confirmed via Anthropic's own documentation |
| CLI stream-json format and flags | HIGH | Confirmed via `claude --help` on user's system |
| Tauri integration via tauri-plugin-shell | HIGH | Well-documented Tauri 2.x plugin |
| Agent SDK cannot run in Tauri WebView directly | HIGH | Requires Node.js child_process, unavailable in browser |

---

## 6. Sources

### Official Documentation
- [Claude Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Anthropic Engineering - Effective Harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)
- [Claude Code GitHub](https://github.com/anthropics/claude-code)

### OpenCode
- [OpenCode Official Site](https://opencode.ai/)
- [GitHub - sst/opencode](https://github.com/sst/opencode)
- [InfoQ - OpenCode Coding Agent](https://www.infoq.com/news/2026/02/opencode-coding-agent/)
- [OpenCode vs Claude Code (Builder.io)](https://www.builder.io/blog/opencode-vs-claude-code)

### Conductor
- [Conductor.build](https://www.conductor.build/)
- [GitHub - claude-conductor](https://github.com/superbasicstudio/claude-conductor)
- [GitHub - code-conductor](https://github.com/ryanmac/code-conductor)
- [The New Stack - Hands-On Review](https://thenewstack.io/a-hands-on-review-of-conductor-an-ai-parallel-runner-app/)
- [Parallel Agent Multiplier Article](https://elite-ai-assisted-coding.dev/p/the-parallel-agent-multiplier-conductor-with-charlie-holtz)
- [Conductor for Claude Code (Medium)](https://ai.plainenglish.io/conductor-for-claude-code-95a792c12285)

### Pencil
- [Pencil.dev](https://www.pencil.dev/)
- [Pencil Documentation](https://docs.pencil.dev/getting-started)
- [Pencil AI Integration Docs](https://docs.pencil.dev/getting-started/ai-integration)
- [Pencil.dev Bridging Design-to-Code (Medium)](https://medium.com/@tentenco/pencil-dev-bridging-the-design-to-code-gap-in-modern-development-fede236fa551)

### Tauri
- [Tauri v2 Shell Plugin](https://v2.tauri.app/plugin/shell/)
