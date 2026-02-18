# AI Chat UI Library Research for Pluribus (Tauri + Claude Code CLI)

**Date:** 2026-02-08
**Context:** React 19 + Tauri v2 + Vite 7 + Tailwind 4 + shadcn/Radix UI
**Key Constraint:** Claude Code runs as a local subprocess via `@tauri-apps/plugin-shell`, outputting `stream-json` to stdout — NOT HTTP/SSE

---

## Executive Summary

For your Tauri app that spawns Claude Code as a subprocess and parses its stdout, the critical differentiator between libraries is **custom transport support** — most assume HTTP/SSE, but your data comes from a local CLI process. After evaluating 10+ options, the **recommended stack** is:

| Layer | Recommendation | Rationale |
|-------|---------------|-----------|
| **Chat UI** | **assistant-ui** | Best branching support, composable Radix-style primitives, `LocalRuntime` with async generator adapter fits your subprocess model perfectly |
| **Graph Visualization** | **ReactFlow** | De facto standard (34k stars, 1M+ weekly downloads), custom nodes for agent state |
| **Protocol (future)** | **AG-UI** | Emerging industry standard for agent-frontend communication |

---

## Detailed Comparison

### 1. Vercel AI SDK (`ai` + `@ai-sdk/react`)

| Metric | Value |
|--------|-------|
| GitHub Stars | 21,558 |
| npm Downloads | 20M+/month |
| Latest Version | SDK 6 (v6.0.77, Feb 2026) |
| React Support | 18, 19 |

**Streaming:** Default is SSE, but SDK 5+ introduced a **transport-based architecture**. You can write a custom transport that returns `ReadableStream<UIMessageChunk>` from any source. `DirectChatTransport` proves HTTP is not required. You would need to build a `TauriShellTransport` that pipes subprocess stdout into `UIMessageChunk` objects.

**Branching:** **Not supported.** Confirmed by the core team in [GitHub Discussion #8451](https://github.com/vercel/ai/discussions/8451) — not a priority.

**Tool Calls:** Excellent. Typed `message.parts` system with states: `partial-call` → `call` → `output-available`. SDK 6 adds `needsApproval` for human-in-the-loop.

**Agent Visualization:** None. Hooks-only library, no UI components at all.

**Key Concern:** No branching is a dealbreaker for your stated requirements. SDK RSC (`streamUI`) is deprecated — do not build on it.

**Verdict:** Strong data layer, but you'd need to pair it with assistant-ui for branching and build all UI yourself.

---

### 2. assistant-ui (`@assistant-ui/react`) — RECOMMENDED

| Metric | Value |
|--------|-------|
| GitHub Stars | ~6,000 |
| npm Downloads | ~50k+/week |
| Latest Version | v0.12.6 (Feb 2026) |
| React Support | 18, 19 |
| Backing | YC-backed startup |

**Streaming:** Three runtime options, all supporting custom backends:
- **`LocalRuntime`** with `ChatModelAdapter` — implements an `async *run()` generator that yields content chunks. This is the **ideal fit** for your subprocess: read stdout lines, parse JSON, yield `{ content: [{ type: "text", text }] }` and `{ content: [{ type: "tool-call", ... }] }`.
- **`ExternalStoreRuntime`** — wraps external state (e.g., AI SDK's `useChat`). You provide `messages`, `isRunning`, `onNew`, `convertMessage`.
- **`AssistantTransportRuntime`** — wire protocol for client-server.

**Branching:** **First-class support.** Built-in message editing, conversation branching (explore different paths), and branch navigation UI. This is a headline feature.

**Tool Calls:** Yes. Yield `{ type: "tool-call", toolCallId, toolName, args }` content parts from your adapter. Custom tool renderers via the tools API.

**Agent Visualization:** No built-in graph mode, but the composable architecture makes it easy to swap between chat view and a ReactFlow graph view.

**Architecture:** Radix-style composable primitives (`ThreadPrimitive`, `MessagePrimitive`, `ComposerPrimitive`). State management via Zustand internally. Streaming infrastructure via `assistant-stream` package.

**How it fits Pluribus:**
```typescript
// Conceptual adapter for Claude Code subprocess
const claudeAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal }) {
    const command = Command.create('claude', ['-p', prompt, '--output-format', 'stream-json']);
    const child = await command.spawn();

    for await (const line of child.stdout) {
      const event = JSON.parse(line);
      if (event.type === 'assistant' && event.message?.content) {
        yield { content: event.message.content.map(b => ({ type: "text", text: b.text })) };
      }
      if (event.type === 'content_block_delta' && event.delta?.type === 'tool_use') {
        yield { content: [{ type: "tool-call", toolCallId: event.id, toolName: event.name, args: event.input }] };
      }
    }
  }
};
```

**Verdict:** Best overall fit. Native branching, composable Radix-style components that match your shadcn stack, and the `LocalRuntime` async generator pattern maps directly to reading subprocess stdout.

---

### 3. CopilotKit (`@copilotkit/react-ui`)

| Metric | Value |
|--------|-------|
| GitHub Stars | 20,000+ |
| npm Downloads | ~69k/week |
| Latest Version | v1.50 (Dec 2025) |
| React Support | 18, 19 |

**Streaming:** Uses AG-UI protocol natively. AG-UI is **transport-agnostic** (HTTP, WebSocket, WebRTC, or any streaming channel). Excellent for Tauri.

**Branching:** Not first-class in the chat UI, but supports time-travel and resumable conversations via thread model.

**Tool Calls:** Yes. Generative UI pattern — agents render React components dynamically. Shared state between agent and frontend.

**Agent Visualization:** No built-in graph viz. CopilotKit focuses on the chat/copilot interaction layer.

**Key Concern:** CopilotKit is a **heavier framework** with opinions about backend architecture. It's designed for full-stack agentic apps where the backend speaks AG-UI. Your use case (spawning a local CLI subprocess) doesn't align with its typical architecture. You'd need to wrap your subprocess in an AG-UI event emitter, which adds complexity.

**Verdict:** Powerful but over-engineered for a "wrap a CLI subprocess" use case. Better suited if you later build a proper agent backend service.

---

### 4. LangGraph `useStream` Hook (`@langchain/langgraph-sdk`)

| Metric | Value |
|--------|-------|
| Part of | LangGraph JS SDK |
| Branching | **Best-in-class** |
| Custom Transport | Yes (async generator) |

**Streaming:** Handles message chunk concatenation, loading states, errors. The custom transport function returns an async generator yielding events.

**Branching:** **The best branching implementation researched.** Uses checkpoints — `getMessagesMetadata()` provides the checkpoint where each message was first seen, and you can create new runs from preceding checkpoints.

**Tool Calls:** Yes, via LangGraph's tool-calling agent model.

**Key Concern:** Designed for LangGraph Platform API. Custom transport support exists but is less documented. No UI components — purely a data hook.

**Verdict:** If you adopt LangGraph as your agent orchestration layer, this hook is excellent. Can be paired with assistant-ui for the component layer. However, it assumes LangGraph's data model, which may not match Claude Code's `stream-json` output format without an adapter.

---

### 5. Other Options (Brief)

| Library | Streaming | Branching | Tool Calls | Transport | Verdict |
|---------|-----------|-----------|------------|-----------|---------|
| **Ant Design X** (`@ant-design/x` v2.0) | Yes | No | Manual | Custom provider | Nice `ThoughtChain` component for reasoning viz, but Ant Design styling conflicts with Tailwind/shadcn |
| **NLUX** (`@nlux/react`) | Yes | No | No | Custom adapter | Zero dependencies (good for Tauri bundle size), but too minimal for your needs |
| **react-chat-elements** | No | No | No | Manual | Traditional messaging UI, not AI-aware. Not recommended |
| **ChatUI (Alibaba)** | Basic | No | No | Manual | Legacy, superseded by Ant Design X |
| **TanStack AI** (`@tanstack/ai-react`) | Yes | No | Yes (typed) | Provider adapters | Very new (early 2026). Type-safe with Zod. Worth watching, but ecosystem immature |
| **AI Elements** (Vercel) | Yes | No | Via AI SDK | Via AI SDK | Copy-into-codebase shadcn-style components. Good pairing with AI SDK, but no branching |
| **LlamaIndex Chat UI** | SSE | No | Manual | Manual | Niche — only if using LlamaIndex backend |

---

## Agent Graph Visualization

### ReactFlow — RECOMMENDED

| Metric | Value |
|--------|-------|
| GitHub Stars | 34,332 |
| npm Downloads | 1,034,228/week |
| Library | `reactflow` (now under `xyflow` org) |

- **Custom nodes**: Render any React component as a node (agent status, tool execution, model output)
- **Performance**: Handles hundreds of nodes/edges smoothly; 1000+ requires optimization (memoization, Zustand state, progressive rendering)
- **Community**: [LangGraph GUI ReactFlow](https://creati.ai/ai-tools/langgraph-gui-reactflow/) provides pre-built nodes for agent workflows
- **Integration**: Works perfectly alongside any chat library — render chat in one panel, graph in another

**Alternatives considered:**
- **Cytoscape.js** — More academic, less React-native integration
- **reaflow** — Smaller community, React Flow is more battle-tested
- **D3.js** — Too low-level for this use case
- **react-workflow-viz** — Alpha/beta, limited support

---

## Emerging Protocol: AG-UI

The [AG-UI Protocol](https://docs.ag-ui.com/) is becoming the industry standard for agent-frontend communication. It's an open, lightweight, event-based protocol that streams ordered JSON events. Adopted by:
- CopilotKit (native)
- LangGraph
- LlamaIndex
- CrewAI, Mastra, Pydantic AI, Agno

**Recommendation:** Even if you don't adopt AG-UI now, structure your subprocess output parser as an event stream that could be adapted to AG-UI later. Google's related **A2UI** (Agent-to-User Interface) protocol is also emerging.

---

## Recommended Architecture for Pluribus

```
┌─────────────────────────────────────────────┐
│  Tauri App (React 19 + Vite 7 + Tailwind 4) │
│                                              │
│  ┌──────────────┐  ┌──────────────────────┐ │
│  │  Chat Mode   │  │    Graph Mode         │ │
│  │              │  │                       │ │
│  │ assistant-ui │  │    ReactFlow          │ │
│  │ LocalRuntime │  │    (agent nodes,      │ │
│  │ + Claude     │  │     tool nodes,       │ │
│  │   Adapter    │  │     data flow edges)  │ │
│  └──────┬───────┘  └──────────┬───────────┘ │
│         │                     │              │
│         └──────────┬──────────┘              │
│                    │                         │
│         ┌──────────▼───────────┐             │
│         │  Tauri Shell Plugin  │             │
│         │  Command.create()    │             │
│         └──────────┬───────────┘             │
└────────────────────┼─────────────────────────┘
                     │ subprocess stdout (stream-json)
              ┌──────▼───────┐
              │  Claude Code │
              │  CLI Process │
              └──────────────┘
```

**Data flow:**
1. User types in assistant-ui's `Composer`
2. `LocalRuntime` calls your `ChatModelAdapter.run()`
3. Adapter spawns Claude Code via `Command.create('claude', args)`
4. Parse stdout JSON events, yield as assistant-ui content chunks
5. assistant-ui handles rendering, branching, tool call display
6. Graph mode reads the same message/event data and renders as ReactFlow nodes

---

## Confidence Levels

| Finding | Confidence |
|---------|-----------|
| assistant-ui is the best fit for chat UI | **High** — branching + LocalRuntime async generator pattern is a direct match |
| ReactFlow is the best for graph viz | **High** — no serious competitor in the React ecosystem |
| Vercel AI SDK lacks branching | **High** — confirmed by core team |
| AG-UI is the emerging standard | **Medium** — adoption is growing but not universal yet |
| CopilotKit is over-engineered for this use case | **Medium** — it could work, but adds unnecessary framework complexity |

---

## Sources

- [Vercel AI SDK Documentation](https://ai-sdk.dev/docs/introduction)
- [AI SDK 6 Announcement](https://vercel.com/blog/ai-sdk-6)
- [AI SDK Transport Docs](https://ai-sdk.dev/docs/ai-sdk-ui/transport)
- [AI SDK Branching Discussion #8451](https://github.com/vercel/ai/discussions/8451)
- [assistant-ui Documentation](https://www.assistant-ui.com/docs)
- [assistant-ui GitHub](https://github.com/assistant-ui/assistant-ui)
- [assistant-ui LocalRuntime](https://www.assistant-ui.com/docs/runtimes/custom/local)
- [assistant-ui ExternalStoreRuntime](https://www.assistant-ui.com/docs/runtimes/custom/external-store)
- [assistant-ui v0.12 Migration](https://www.assistant-ui.com/docs/migrations/v0-12)
- [assistant-ui DeepWiki Architecture](https://deepwiki.com/assistant-ui/assistant-ui)
- [CopilotKit GitHub](https://github.com/CopilotKit/CopilotKit)
- [CopilotKit AG-UI Integration](https://docs.copilotkit.ai/langgraph/)
- [AG-UI Protocol](https://docs.ag-ui.com/)
- [AG-UI GitHub](https://github.com/ag-ui-protocol/ag-ui)
- [LangGraph useStream Hook](https://docs.langchain.com/langsmith/use-stream-react)
- [LangGraph useStream Announcement](https://changelog.langchain.com/announcements/usestream-for-integrating-langgraph-for-your-react-app)
- [ReactFlow](https://reactflow.dev)
- [ReactFlow Performance Guide](https://reactflow.dev/learn/advanced-use/performance)
- [Ant Design X](https://github.com/ant-design/x)
- [NLUX Documentation](https://docs.nlkit.com/nlux)
- [TanStack AI](https://github.com/TanStack/ai)
- [AI Elements by Vercel](https://ai-sdk.dev/elements)
- [LlamaIndex Chat UI](https://ui.llamaindex.ai/)
- [The React + AI Stack for 2026](https://www.builder.io/blog/react-ai-stack-2026)
