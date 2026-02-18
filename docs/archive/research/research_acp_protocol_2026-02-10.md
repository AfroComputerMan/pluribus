# Research Report: Agent Client Protocol (ACP) — Relevance to Pluribus

**Date**: 2026-02-10
**Topic**: Zed's Agent Client Protocol and its applicability to Pluribus
**Confidence**: High (based on official docs, SDK, and multiple technical sources)

---

## Executive Summary

The **Agent Client Protocol (ACP)** is an open standard (Apache-licensed) that standardizes JSON-RPC communication between **code editors** (clients) and **AI coding agents** (servers). Created by Zed Industries with backing from Google, JetBrains, and others, it defines a structured protocol for exactly the kind of integration Pluribus is building: a desktop app communicating with Claude CLI as a subprocess.

**Key finding**: ACP is highly relevant to Pluribus. It could replace our custom stream-parsing layer in `claude-adapter.ts` (~800 lines) with a standardized protocol that Claude Code already supports. However, it's designed for *code editor* use cases, not general chat — so adoption would require evaluating whether its editor-centric abstractions (file system, terminals, tool calls) map well to Pluribus's chat-focused UX.

---

## What ACP Is

### The Problem It Solves

Before ACP, every code editor had to build custom integrations for every AI agent. Claude Code needed a Zed plugin, a VS Code extension, a JetBrains plugin, etc. ACP creates a universal protocol so:
- **Agents implement ACP once** → work in any ACP-compatible editor
- **Editors implement ACP once** → support any ACP-compatible agent

### The MCP vs ACP Distinction

| Protocol | Purpose | Handles |
|----------|---------|---------|
| **MCP** (Model Context Protocol) | Agent ↔ Data/Tools | *What* data and tools agents can access |
| **ACP** (Agent Client Protocol) | Agent ↔ Editor/UI | *Where* the agent lives in your workflow |

They're complementary. ACP even supports MCP-over-ACP transport, where the editor can expose MCP servers to agents through the ACP connection.

---

## Technical Architecture

### Transport

- **Local agents**: JSON-RPC 2.0 over **stdin/stdout** (subprocess model)
- **Remote agents**: HTTP/WebSocket (work-in-progress)
- All communication is bidirectional — agents can request things from the editor

### Connection Lifecycle

```
1. Client spawns agent subprocess
2. initialize → Agent declares capabilities
3. session/new or session/load → Establish conversation
4. session/prompt → Send user input
5. session/update (streaming notifications) → Agent streams responses
6. Agent may call fs/*, terminal/*, session/request_permission
7. session/cancel → User can interrupt
```

### Core Protocol Methods

**Agent-side (required)**:
- `initialize` — Capability negotiation
- `session/new` — Create fresh session
- `session/prompt` — Send user message
- `session/cancel` — Interrupt processing

**Agent-side (optional)**:
- `session/load` — Resume prior session
- `session/set_mode` — Switch operating modes
- `authenticate` — Access verification

**Client-side (editor provides to agent)**:
- `fs/read_text_file` — Read files (including unsaved editor changes)
- `fs/write_text_file` — Write/create files
- `terminal/create` — Execute shell commands
- `terminal/output` — Get command output
- `terminal/wait_for_exit` — Block until command completes
- `terminal/kill` / `terminal/release` — Process management
- `session/request_permission` — Approval workflow for sensitive actions

### Session Model

- A single connection supports **concurrent sessions** (multiple independent threads)
- Sessions maintain their own context, history, and state
- Sessions can be created, loaded (resumed), forked, and deleted
- This maps closely to Pluribus's thread model

### Tool Call Reporting

Agents report tool usage through `session/update` with structured data:
- `toolCallId`, `title`, `kind` (read/edit/delete/execute/search/think/fetch)
- `status` progression: pending → in_progress → completed/failed
- `content` (results), `locations` (affected files), `rawInput`/`rawOutput`
- Real-time incremental updates via `tool_call_update`
- Permission requests before sensitive operations

### Content Format

- User-readable content defaults to **Markdown**
- Reuses MCP's JSON representations where possible
- Supports content blocks: text, images, resources, diffs, terminal references

---

## Ecosystem Status (Feb 2026)

### Supported Editors (Clients)
| Editor | Status |
|--------|--------|
| Zed | Native support |
| JetBrains IDEs | Supported (with ACP Registry) |
| Neovim | Two plugins (CodeCompanion, avante.nvim) |
| Emacs | agent-shell plugin |
| marimo notebooks | Supported |
| Eclipse | Prototype |

### Supported Agents
| Agent | Status |
|-------|--------|
| **Claude Code** | Supported (via SDK adapter) |
| Gemini CLI | Reference implementation |
| Codex CLI | Community adapter + official WIP |
| GitHub Copilot CLI | Available |
| Goose (Block/Square) | Supported |
| Aider | In development |
| Cline, OpenHands | Available |

### SDKs
- **TypeScript**: `@agentclientprotocol/sdk` (npm)
- **Rust**: `agent-client-protocol` (crate)
- **Python**: `python-sdk`
- **Kotlin**: `acp-kotlin`

---

## Relevance to Pluribus

### Current Pluribus Architecture

```
User Input → assistant-ui Runtime → ChatModelAdapter.run()
  → Tauri Shell (Command.create) → Claude CLI subprocess
  → Stream JSON events → Adapter yields content → assistant-ui renders
```

Key pain points (from REVIEW.md):
1. Custom stream parsing of Claude CLI JSON events (~800 lines in claude-adapter.ts)
2. Complex session management (resume/session-ID/fresh retry strategy)
3. `sh -c` shell invocation (security concern)
4. Only last message sent (relies on Claude CLI's `--resume`)
5. No structured tool call visibility

### How ACP Would Change This

```
User Input → assistant-ui Runtime → ACP Client (TypeScript SDK)
  → JSON-RPC over stdin/stdout → Claude Code (ACP agent)
  → Structured session/update notifications → assistant-ui renders
```

### Direct Benefits

| Current Problem | ACP Solution |
|----------------|--------------|
| Custom JSON stream parsing | Structured JSON-RPC with typed SDK |
| Complex session resume logic | `session/new` + `session/load` built into protocol |
| No tool call visibility | Tool call reporting with kind/status/content |
| `sh -c` security concern | Direct subprocess spawn, no shell wrapper |
| Thread switching destroys state | Concurrent sessions on single connection |
| No file operation feedback | `fs/read_text_file`, `fs/write_text_file` with diffs |
| No terminal output visibility | `terminal/create` + `terminal/output` streaming |
| Permission management absent | `session/request_permission` with user approval UI |

### What ACP Would Enable

1. **Rich tool call UI**: Show file edits as diffs, terminal output inline, search results with file locations — all structured data from the protocol
2. **Permission workflows**: The agent asks for permission before file writes or command execution, and Pluribus can show a native approval dialog
3. **Session persistence**: Load/resume sessions is a first-class protocol operation, eliminating our custom retry strategy
4. **Multiple concurrent sessions**: The protocol supports multiple sessions on one connection, aligning with our thread model
5. **Follow-along mode**: Track which files the agent is reading/editing in real time (tool call `locations` field)

### Concerns and Tradeoffs

1. **Editor-centric design**: ACP assumes the client is a code editor. Pluribus is a chat app. Some abstractions (file trees, diagnostics, syntax highlighting) may not map cleanly.

2. **Claude Code as ACP agent vs CLI**: We currently invoke `claude` CLI directly. To use ACP, we'd need Claude Code running in ACP mode. This may require different invocation flags or a different binary mode.

3. **assistant-ui integration**: We'd need to bridge ACP's `session/update` streaming notifications to assistant-ui's `ChatModelAdapter` interface. The SDK provides typed TypeScript, which helps, but this is a new integration layer to build.

4. **Maturity**: The protocol is ~6 months old with active development. APIs may change. The TypeScript SDK is at v0.14.x.

5. **Overhead for chat-only use**: If Pluribus remains primarily a chat interface (not a code editor), much of ACP's value (file system mediation, terminal management) adds complexity without clear benefit — unless we want to show tool calls richly in the UI.

6. **Tauri Shell plugin compatibility**: ACP expects stdin/stdout subprocess communication. Tauri's shell plugin supports this, but we'd need to verify the TypeScript SDK can work within Tauri's security sandbox.

---

## Comparison: Current Approach vs ACP

| Dimension | Current (Custom) | With ACP |
|-----------|------------------|----------|
| Protocol | Ad-hoc JSON stream parsing | Standardized JSON-RPC 2.0 |
| Session mgmt | Custom Map + localStorage | Protocol-native session/new + session/load |
| Tool visibility | None (black box) | Structured tool call reporting |
| File operations | Not mediated | Client-mediated with approval |
| Terminal | Not visible | Streaming terminal output |
| Permissions | None | Built-in request_permission |
| SDK support | None (custom code) | Official TypeScript SDK |
| Maintenance burden | High (track CLI changes) | Lower (standardized contract) |
| Complexity | ~800 lines adapter | SDK + adapter bridge |
| Ecosystem | Locked to Claude CLI | Any ACP agent (Gemini, Codex, Goose...) |

---

## Recommendations

### If the goal is "better Claude CLI integration"
**Moderate benefit.** ACP would give structured session management and tool call visibility, replacing our custom parsing. But if we only care about chat text, the current approach works and is simpler.

### If the goal is "rich agentic coding UI"
**High benefit.** ACP is purpose-built for this. File diffs, terminal output, permission dialogs, tool call progress — all structured. This would transform Pluribus from a chat wrapper into an agent IDE interface.

### If the goal is "multi-agent support"
**Very high benefit.** ACP is agent-agnostic. Implementing ACP client support once would let users connect Claude Code, Gemini CLI, Codex, Goose, or any ACP agent. This is a major differentiator.

### Suggested Next Steps

1. **Prototype**: Install `@agentclientprotocol/sdk`, spawn Claude Code in ACP mode, and verify basic session/prompt flow works within Tauri
2. **Evaluate**: Test whether Claude Code's ACP mode provides equivalent functionality to our current `--resume` CLI invocation
3. **Bridge**: Design the adapter between ACP's `session/update` streaming and assistant-ui's `ChatModelAdapter.run()` yield interface
4. **Decide**: Based on prototype results, decide whether to migrate fully or keep ACP as an optional backend

---

## Sources

- [Zed ACP Landing Page](https://zed.dev/acp)
- [ACP Official Documentation](https://agentclientprotocol.com/overview/introduction)
- [ACP Architecture](https://agentclientprotocol.com/overview/architecture)
- [ACP Protocol Overview](https://agentclientprotocol.com/protocol/overview)
- [ACP File System Operations](https://agentclientprotocol.com/protocol/file-system)
- [ACP Terminal Operations](https://agentclientprotocol.com/protocol/terminals)
- [ACP Tool Calls](https://agentclientprotocol.com/protocol/tool-calls)
- [ACP TypeScript SDK (npm)](https://www.npmjs.com/package/@agentclientprotocol/sdk)
- [ACP GitHub Repository](https://github.com/zed-industries/agent-client-protocol)
- [TypeScript SDK Examples](https://github.com/agentclientprotocol/typescript-sdk/tree/main/src/examples)
- [JetBrains ACP Blog Post](https://blog.jetbrains.com/ai/2025/10/jetbrains-zed-open-interoperability-for-ai-coding-agents-in-your-ide/)
- [JetBrains ACP Registry](https://blog.jetbrains.com/ai/2026/01/acp-agent-registry/)
- [Goose Intro to ACP](https://block.github.io/goose/blog/2025/10/24/intro-to-agent-client-protocol-acp/)
- [Zed ACP Progress Report](https://zed.dev/blog/acp-progress-report)
- [The Register: Google, Zed fight VS Code lock-in](https://www.theregister.com/2025/08/28/google_zed_acp/)
- [Zed External Agents Documentation](https://zed.dev/docs/ai/external-agents)
