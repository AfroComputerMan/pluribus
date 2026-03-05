# Pluribus — AI Agent Mission Control

## What This Is

A desktop command center for orchestrating multiple AI agents across different codebases. Users manage workspaces (groups of repos), spin up agent threads within those workspaces, and control each agent's execution in real-time or asynchronously. Built as a Tauri 2 + React desktop app, forking and pivoting from the existing Pluribus single-chat prototype.

## Core Value

Run multiple AI agents simultaneously across repos and have full control over every one of them — watch live output, approve/reject tool calls, pause/resume, or fire-and-forget and check results later.

## Requirements

### Validated

<!-- Capabilities proven in the existing Pluribus codebase -->

- ✓ Single-thread chat with Claude CLI via Tauri shell plugin — existing
- ✓ Single-thread chat with Claude Agent SDK via Bun sidecar — existing
- ✓ Single-thread chat with Codex via Rust-managed process — existing
- ✓ SQLite persistence for threads, messages, and session state — existing
- ✓ assistant-ui runtime for chat primitives and thread management — existing
- ✓ Streaming output rendering with markdown and code highlighting — existing
- ✓ Tool call display (file edits, shell commands) — existing
- ✓ Thread list sidebar with navigation — existing
- ✓ Settings overlay with engine toggle — existing
- ✓ Dev event inspector panel — existing

### Active

<!-- v1.0: Multi-Thread Agent Orchestration -->

- [ ] Multi-thread agent orchestration — spin up multiple agent threads simultaneously
- [ ] Per-agent live output streaming with real-time intervention (approve/reject tool calls, pause/resume)
- [ ] Agent provider abstraction — support Claude Code CLI, Agent SDK, Codex, and extensible to other providers
- [ ] Per-thread context and working directory scoping
- [ ] Agent status tracking — running, idle, error, completed across all threads
- [ ] Drill-down from overview to individual agent thread view

### Future (v1.1+)

- Dashboard overview showing all workspaces, active agents, and recent activity
- Workspace management — create, configure, and group repos into workspaces
- Fire-and-forget mode — launch agents, get notified on completion or errors
- Workspace-level MCP server configuration with per-thread overrides (inherit + customize)

### Out of Scope

- Cloud/web deployment — this is a local desktop app, no server component
- Building custom AI models or fine-tuning — orchestrates existing AI tools
- Team collaboration features — single-user mission control
- Mobile app — desktop-first (Tauri)
- Plugin marketplace for MCP servers — manual configuration is sufficient for v1

## Current Milestone: v1.0 Multi-Thread Agent Orchestration

**Goal:** Enable running multiple AI agents simultaneously with live output, status tracking, and real-time intervention — the core orchestration engine.

**Target features:**
- Multi-thread agent orchestration
- Per-agent live output with intervention controls
- Agent provider abstraction (Claude CLI, Agent SDK, Codex)
- Per-thread context and working directory scoping
- Agent status tracking across all threads
- Drill-down from overview to individual agent thread

## Context

This is a fork-and-pivot from the existing Pluribus codebase. Pluribus validated:
- Tauri 2 as a viable desktop shell for AI agent UIs
- assistant-ui as a powerful chat primitive framework
- The adapter pattern for supporting multiple AI backends (Claude CLI, Agent SDK, Codex)
- SQLite as a solid local persistence layer
- Bun sidecar pattern for running Node/Bun-dependent SDKs alongside Tauri

The pivot is from single-thread chat to multi-agent orchestration. The core pain point is context switching between multiple Claude Code sessions across different repos. The dashboard-first UX replaces the current thread-list sidebar as the primary navigation.

The existing codebase has three adapter implementations (Claude CLI shell, Agent SDK sidecar, Codex via Rust process) that can be refactored into a unified provider abstraction.

## Constraints

- **Tech stack**: Tauri 2 + React 19 + assistant-ui — proven in current codebase, keep the stack
- **Local-only**: No cloud services, all data stays on the user's machine
- **CLI dependency**: Agents require Claude CLI / Codex CLI installed on the host machine
- **Process isolation**: Each agent thread needs its own process lifecycle (no shared CLI sessions)
- **MCP servers**: Must support per-workspace defaults with per-thread override inheritance

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Fork Pluribus, don't rewrite | Proven patterns (Tauri, assistant-ui, SQLite, adapters) worth keeping | — Pending |
| Dashboard-first UX | Context switching is the core pain — need overview before drill-down | — Pending |
| Workspace model for repos | Natural grouping (monorepo = 1 workspace, microservices = grouped) | — Pending |
| Multi-provider support | Not locked to one AI provider — Claude, Codex, and future agents | — Pending |
| MCP inheritance model | Workspace defaults + per-thread overrides avoids repetitive config | — Pending |

---
*Last updated: 2026-03-05 after milestone v1.0 started*
