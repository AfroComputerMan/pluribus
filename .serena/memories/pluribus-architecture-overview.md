# Pluribus Architecture Overview

## What Is Pluribus?
A Tauri 2 + React 19 desktop app providing a chat UI for Claude CLI. Uses **assistant-ui** for chat primitives and spawns Claude CLI as a subprocess via Tauri's shell plugin.

## Data Flow
```
User Input → assistant-ui Runtime → ChatModelAdapter.run()
  → Tauri Shell (Command.create) → Claude CLI subprocess (--output-format stream-json)
  → Stream JSON events → processStreamEvent() → ContentBlockAccumulator → yield content → assistant-ui renders
```

## Tech Stack
- **Frontend**: React 19, TypeScript (strict), Tailwind CSS v4, shadcn/ui (new-york style)
- **Chat Framework**: assistant-ui v0.12 (primitives-based composition)
- **Desktop**: Tauri 2 (Rust), tauri-plugin-shell, tauri-plugin-sql (SQLite), tauri-plugin-dialog
- **Database**: SQLite via @tauri-apps/plugin-sql
- **Package Manager**: bun
- **Build Tool**: Vite 7
- **State**: Module-level Maps in claude-adapter.ts, SQLite for persistence, minimal Zustand

## File Statistics
- ~5,100 TypeScript lines + ~54 Rust lines
- 23 TypeScript/TSX files, 2 Rust files
- 4 SQLite migration files
- 16 npm production dependencies, 6 Rust dependencies

## Key Architectural Decisions
1. assistant-ui provides runtime, thread management, and UI primitives — not custom built
2. Claude CLI manages its own conversation history via --resume/--session-id
3. SQLite is the persistence layer (threads, messages, sessions, workspaces, dev events, usage)
4. Module-level Maps are the in-memory source of truth; SQLite is write-through
5. Thread locking uses FIFO waiter queue to prevent concurrent CLI invocations per thread
