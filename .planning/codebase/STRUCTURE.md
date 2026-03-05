# Codebase Structure

**Analysis Date:** 2026-03-05

## Directory Layout

```
pluribus/
├── src/                          # React frontend source
│   ├── main.tsx                  # React entry point
│   ├── App.tsx                   # Root component
│   ├── App.css                   # Global styles
│   ├── loading-animations.css    # Loading animation styles
│   ├── vite-env.d.ts             # Vite type declarations
│   ├── assets/                   # Static assets (images, SVGs)
│   ├── components/               # React components
│   │   ├── assistant-ui/         # assistant-ui primitive compositions
│   │   ├── ui/                   # shadcn/ui base components
│   │   ├── RuntimeProvider.tsx   # assistant-ui runtime setup
│   │   ├── ThreadWorkspace.tsx   # Main layout shell
│   │   ├── settings-overlay.tsx  # Settings dialog
│   │   ├── DevPanel.tsx          # Dev-only event inspector
│   │   └── ThreadStatusToasts.tsx # Background thread notifications
│   ├── hooks/                    # Custom React hooks
│   │   └── use-media-query.ts    # Responsive breakpoint hook
│   └── lib/                      # Core logic, adapters, utilities
│       ├── router-adapter.ts     # Top-level model router
│       ├── claude-adapter.ts     # Shell-based Claude CLI adapter
│       ├── agent-sdk-adapter.ts  # Agent SDK sidecar adapter
│       ├── codex-adapter.ts      # Codex app-server adapter
│       ├── db.ts                 # SQLite persistence layer
│       ├── models.ts             # Model registry and resolution
│       ├── sqlite-thread-list-adapter.ts   # Thread list persistence
│       ├── sqlite-thread-history-adapter.tsx # Message history persistence
│       ├── thread-status-store.ts  # Zustand thread status store
│       ├── codex-approval-store.ts # Zustand Codex approval store
│       ├── claude-config-reader.ts # Claude CLI config file parser
│       ├── workspace-repo-metadata.ts # Git repo metadata reader
│       ├── dev-event-batcher.ts  # Dev event SQLite batch writer
│       ├── breakpoints.ts        # Responsive breakpoint constants
│       └── utils.ts              # cn() class name merge utility
├── src-tauri/                    # Tauri Rust backend
│   ├── src/
│   │   ├── main.rs               # Tauri main entry
│   │   ├── lib.rs                # Plugin registration, migrations, commands
│   │   └── codex/                # Codex integration module
│   │       ├── mod.rs            # Module declaration
│   │       ├── service.rs        # CodexService (process management)
│   │       ├── commands.rs       # Tauri invoke commands
│   │       └── types.rs          # AgentEvent, Usage types
│   ├── migrations/               # SQLite schema migrations
│   │   ├── 001_initial_schema.sql
│   │   ├── 002_thread_dev_panel_state.sql
│   │   ├── 003_ensure_mcp_invocations.sql
│   │   ├── 004_workspaces_and_thread_branch.sql
│   │   ├── 005_thread_model_effort.sql
│   │   ├── 006_config_overrides.sql
│   │   └── 007_global_settings.sql
│   ├── capabilities/
│   │   └── default.json          # Shell permission grants
│   ├── binaries/                 # Compiled sidecar binaries (build artifact)
│   ├── icons/                    # App icons
│   └── gen/                      # Tauri-generated code (Android, schemas)
├── sidecar/                      # External process sidecars
│   └── agent-sdk-bridge/
│       ├── index.ts              # Bun sidecar entry point
│       ├── package.json          # Sidecar dependencies
│       └── bun.lock              # Sidecar lockfile
├── index.html                    # Vite HTML entry
├── package.json                  # Root dependencies and scripts
├── bun.lock                      # Root lockfile
├── vite.config.ts                # Vite + Tailwind + Tauri config
├── tsconfig.json                 # TypeScript config (root)
├── tsconfig.app.json             # TypeScript config (app)
├── tsconfig.node.json            # TypeScript config (node/vite)
├── components.json               # shadcn/ui configuration
├── CLAUDE.md                     # Project instructions for Claude Code
├── AGENTS.md                     # Agent instructions
└── docs/                         # Documentation and plans
    ├── plans/                    # Feature planning docs
    └── archive/                  # Archived planning docs
```

## Directory Purposes

**`src/components/assistant-ui/`:**
- Purpose: Chat UI compositions built on assistant-ui primitives
- Contains: Thread view, thread list, tool displays, markdown renderer, tooltips
- Key files:
  - `thread.tsx` (~37k) -- main chat view with composer, messages, tool calls
  - `thread-list.tsx` (~42k) -- sidebar thread list with workspace filtering
  - `claude-tool-display.tsx` (~25k) -- Claude CLI tool call rendering (file edits, shell commands, MCP)
  - `codex-tool-display.tsx` (~14k) -- Codex tool call rendering
  - `markdown-text.tsx` (~6k) -- Markdown + code highlighting
  - `tool-fallback.tsx` (~9k) -- Generic tool call display
  - `approval-banner.tsx` (~1.7k) -- Codex tool approval banner
  - `tooltip-icon-button.tsx` (~1k) -- Reusable icon button with tooltip

**`src/components/ui/`:**
- Purpose: shadcn/ui base components (generated, not custom)
- Contains: `button.tsx`, `badge.tsx`, `card.tsx`, `collapsible.tsx`, `dialog.tsx`, `popover.tsx`, `sheet.tsx`, `skeleton.tsx`, `tooltip.tsx`
- Key detail: Generated via `shadcn` CLI. New-york style, slate base color. Do not hand-edit.

**`src/lib/`:**
- Purpose: All non-UI logic -- adapters, persistence, state, utilities
- Contains: ChatModelAdapter implementations, SQLite layer, model registry, Zustand stores, config readers
- Key files: See directory layout above; `claude-adapter.ts` (~60k) is by far the largest file

**`src-tauri/src/codex/`:**
- Purpose: Rust module managing the `codex app-server` child process
- Contains: Process lifecycle, JSON-RPC communication, Tauri command handlers, event types
- Key files:
  - `service.rs` (~14k) -- `CodexService` struct with stdin/stdout/event tasks
  - `commands.rs` (~4.5k) -- Tauri `#[tauri::command]` handlers
  - `types.rs` (~1k) -- `AgentEvent` and `Usage` serde types

**`src-tauri/migrations/`:**
- Purpose: SQLite schema evolution
- Contains: 7 sequential migration files
- Key detail: Migrations are embedded at compile time via `include_str!()` in `lib.rs`

**`sidecar/agent-sdk-bridge/`:**
- Purpose: Bun sidecar that wraps `@anthropic-ai/claude-agent-sdk`
- Contains: Single `index.ts` entry point with NDJSON protocol
- Key detail: Compiled to native binary via `bun build --compile`, placed in `src-tauri/binaries/` with target triple suffix

## Key File Locations

**Entry Points:**
- `index.html`: Vite HTML entry, loads `/src/main.tsx`
- `src/main.tsx`: React DOM root mount
- `src/App.tsx`: Root component, sets up RuntimeProvider + ThreadWorkspace
- `src-tauri/src/main.rs`: Tauri binary entry (calls `lib::run()`)
- `src-tauri/src/lib.rs`: Plugin registration, migration loading, command registration
- `sidecar/agent-sdk-bridge/index.ts`: Bun sidecar entry

**Configuration:**
- `vite.config.ts`: Vite dev server (port 1420), Tailwind plugin, path aliases
- `tsconfig.json`: TypeScript strict mode, `@/*` path alias to `src/*`
- `components.json`: shadcn/ui config (new-york style, slate, `@/components/ui`)
- `src-tauri/capabilities/default.json`: Shell permission grants for `claude`, `sh`, `git`, `codex`, `agent-sdk-bridge`
- `src-tauri/tauri.conf.json`: Tauri app config (if present)

**Core Logic:**
- `src/lib/router-adapter.ts`: Model routing -- determines which adapter handles each thread
- `src/lib/db.ts`: All SQLite operations, exported as `db` namespace object
- `src/lib/models.ts`: Model registry (Claude + Codex), resolution chain, effort levels
- `src/components/RuntimeProvider.tsx`: Wires assistant-ui runtime with adapters

**Adapters (most important, in order of current usage):**
- `src/lib/agent-sdk-adapter.ts`: Primary Claude adapter (Agent SDK via Bun sidecar)
- `src/lib/codex-adapter.ts`: Codex adapter (via Tauri Rust backend)
- `src/lib/claude-adapter.ts`: Legacy Claude adapter (direct shell invocation)

## Naming Conventions

**Files:**
- kebab-case for all TypeScript/TSX files: `claude-adapter.ts`, `thread-status-store.ts`
- PascalCase for component files that are single-export components: `RuntimeProvider.tsx`, `ThreadWorkspace.tsx`, `DevPanel.tsx`
- Exception: `assistant-ui/` directory uses kebab-case even for component files: `thread.tsx`, `thread-list.tsx`
- snake_case for Rust files: `service.rs`, `commands.rs`, `types.rs`
- Numbered prefix for migrations: `001_initial_schema.sql`

**Directories:**
- kebab-case: `assistant-ui/`, `agent-sdk-bridge/`
- lowercase: `ui/`, `lib/`, `hooks/`, `codex/`

**Exports:**
- Components: PascalCase (`Thread`, `ThreadList`, `RuntimeProvider`)
- Functions: camelCase (`createRouterAdapter`, `createAgentSdkAdapter`, `resolveModel`)
- Stores: `use` prefix with PascalCase (`useThreadStatusStore`, `useCodexApprovalStore`)
- Types/Interfaces: PascalCase (`ThreadRow`, `ClaudeModel`, `AgentEvent`)
- Constants: UPPER_SNAKE_CASE (`DEFAULT_MODEL_ID`, `CLAUDE_MODELS`) or camelCase for module-scoped (`LOG_PREFIX`)

## Where to Add New Code

**New AI Backend Adapter:**
- Create adapter: `src/lib/{name}-adapter.ts` implementing `ChatModelAdapter`
- Add model entries: `src/lib/models.ts` (add to registry, update `isCodexModel` or add new type guard)
- Wire into router: `src/lib/router-adapter.ts` (add routing condition)
- If needs native process: add Rust module under `src-tauri/src/{name}/`
- If needs sidecar: add under `sidecar/{name}/`, update `build:sidecar` script
- Add shell permissions: `src-tauri/capabilities/default.json`

**New UI Component:**
- Check shadcn/ui first: run `bunx shadcn add <component>` (generates to `src/components/ui/`)
- Check assistant-ui primitives: use `ThreadPrimitive.*`, `MessagePrimitive.*`, etc.
- Custom assistant-ui composition: `src/components/assistant-ui/{name}.tsx`
- Custom app component: `src/components/{Name}.tsx`

**New Tool Display:**
- Claude tools: add case to `src/components/assistant-ui/claude-tool-display.tsx`
- Codex tools: add case to `src/components/assistant-ui/codex-tool-display.tsx`
- Generic fallback: `src/components/assistant-ui/tool-fallback.tsx`

**New Database Table:**
- Create migration: `src-tauri/migrations/{NNN}_{description}.sql`
- Register in `src-tauri/src/lib.rs` migrations vec
- Add row type + query functions in `src/lib/db.ts`
- Add to `db` export object at bottom of `db.ts`

**New Zustand Store:**
- Create: `src/lib/{name}-store.ts`
- Pattern: `create<StoreType>((set, get) => ({ ... }))`
- Use `useStore.getState()` in adapters (non-React), `useStore()` hook in components

**New Custom Hook:**
- Location: `src/hooks/use-{name}.ts`

**New Tauri Command:**
- Rust handler: `src-tauri/src/{module}/commands.rs` with `#[tauri::command]`
- Register: add to `invoke_handler` in `src-tauri/src/lib.rs`
- Frontend: call via `invoke("{command_name}")` from `@tauri-apps/api/core`

## Special Directories

**`src-tauri/binaries/`:**
- Purpose: Compiled sidecar binaries for Tauri `externalBin`
- Generated: Yes (by `bun run build:sidecar`)
- Committed: No (build artifact, binary naming includes target triple)

**`src-tauri/gen/`:**
- Purpose: Tauri-generated code (Android, permission schemas)
- Generated: Yes (by Tauri CLI)
- Committed: Yes (tracked in git)

**`dist/`:**
- Purpose: Vite build output
- Generated: Yes (by `vite build`)
- Committed: No

**`node_modules/` and `sidecar/agent-sdk-bridge/node_modules/`:**
- Purpose: Dependencies
- Generated: Yes (by `bun install`)
- Committed: No

**`docs/`:**
- Purpose: Feature planning and archived research documents
- Generated: No
- Committed: Yes

---

*Structure analysis: 2026-03-05*
