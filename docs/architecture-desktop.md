# Pluribus Desktop — Architecture Design & Implementation Plan

> **Date:** 2026-02-08
> **Status:** Design Complete, Pending Implementation
> **Prerequisite:** See `docs/brainstorm-desktop-pivot.md` for research and requirements

## Context

Pluribus is currently a backend workflow orchestration system (Hono + Postgres + Redis). We're pivoting it into a **native desktop chat application** (Tauri 2.0 + React) that wraps the Claude Code CLI for visual AI agent orchestration. The app uses the user's existing Claude Code subscription — no API key configuration needed.

**Key decisions from brainstorming:**
- CLI wrapper approach (spawn `claude` processes, parse `--output-format stream-json` NDJSON)
- Full orchestration UI (team builder, task board, plus chat)
- Worktree-based session isolation
- Pure Tauri (no separate backend, SQLite for persistence, single binary)

---

## 1. System Architecture

```
+--------------------------------------------------------------------+
|                    Pluribus Desktop (Tauri 2.0)                     |
|                                                                      |
|  +-----------------------------+  +-------------------------------+  |
|  |     React Frontend          |  |     Rust Core                 |  |
|  |  (WebView, Vite, TW v4)    |  |                               |  |
|  |                             |  |  ProcessManager               |  |
|  |  Zustand Stores:            |  |   - spawn/kill claude CLI     |  |
|  |   sessionStore              |  |   - stdout->Channel streaming |  |
|  |   chatStore                 |  |   - stdin writing             |  |
|  |   teamStore              <--+--+->                             |  |
|  |   settingsStore             |  |  WorktreeManager              |  |
|  |                             |  |   - git worktree CRUD         |  |
|  |  IPC Layer:                 |  |                               |  |
|  |   invoke() commands         |  |  SQLite (tauri-plugin-sql)    |  |
|  |   Channel<T> streaming      |  |   - sessions, messages        |  |
|  |   listen() events           |  |   - projects, teams, tasks    |  |
|  +-----------------------------+  +-------------------------------+  |
+--------------------------------------------------------------------+
        |                    |                    |
   claude CLI (N)       git CLI            ~/.claude/teams/
```

**Data flow:** User types -> `invoke('send_message')` -> Rust spawns `claude --print --output-format stream-json --verbose` -> stdout lines sent via `Channel<String>` -> TypeScript NDJSON parser -> chatStore -> React re-renders.

---

## 2. Project Structure

```
pluribus-desktop/
├── src-tauri/                        # Rust backend
│   ├── src/
│   │   ├── main.rs                   # Entry point, plugin + command registration
│   │   ├── lib.rs                    # Module declarations
│   │   ├── state.rs                  # AppState: Arc<Mutex<HashMap<SessionId, SessionHandle>>>
│   │   ├── error.rs                  # Error types -> InvokeError
│   │   ├── commands/
│   │   │   ├── mod.rs
│   │   │   ├── session.rs            # create/list/get/delete/update session
│   │   │   ├── chat.rs              # send_message (spawns CLI + streams), abort, resume
│   │   │   ├── project.rs           # open/list/get project
│   │   │   ├── worktree.rs          # create/list/remove/cleanup worktree
│   │   │   ├── team.rs             # create/list teams, get tasks, start team
│   │   │   ├── settings.rs         # get/update settings
│   │   │   └── db.rs               # execute_sql/select_sql (Drizzle sqlite-proxy)
│   │   ├── process/
│   │   │   ├── mod.rs
│   │   │   ├── manager.rs           # Spawn claude, BufReader->Channel line streaming
│   │   │   └── session.rs           # SessionHandle: child, status, stdin writer
│   │   └── worktree/
│   │       ├── mod.rs
│   │       └── manager.rs           # git worktree add/remove/list/prune wrappers
│   ├── Cargo.toml                    # tauri, tauri-plugin-shell, tauri-plugin-sql, tokio, serde
│   ├── tauri.conf.json               # Window config, shell scope (claude, git), sql plugin
│   └── capabilities/default.json     # shell:allow-spawn, sql:default, fs permissions
├── src/                              # React frontend
│   ├── main.tsx
│   ├── App.tsx                       # Router + QueryClient + providers
│   ├── types/
│   │   ├── cli.ts                    # CLIMessage discriminated union (all NDJSON types)
│   │   ├── session.ts               # SessionSummary, SessionStatus, SessionConfig
│   │   ├── chat.ts                  # ChatMessage, ContentBlock, ToolCallCard types
│   │   ├── project.ts              # Project, ProjectSettings
│   │   └── team.ts                 # Team, TeamAgent, TeamTask
│   ├── db/
│   │   ├── schema.ts                # Drizzle sqliteTable definitions
│   │   └── client.ts               # Drizzle sqlite-proxy wrapping invoke('select_sql'/'execute_sql')
│   ├── ipc/
│   │   ├── commands.ts             # Type-safe invoke() wrappers (replaces api/client.ts)
│   │   ├── events.ts              # Type-safe listen() wrappers
│   │   └── channels.ts            # Channel<T> factory for streaming
│   ├── stores/
│   │   ├── sessionStore.ts         # Session list, active session, sidebar state
│   │   ├── chatStore.ts           # Messages per session, streaming state, content blocks
│   │   ├── teamStore.ts          # Teams, tasks, agent statuses
│   │   └── settingsStore.ts      # App preferences (model, autonomy, theme)
│   ├── hooks/
│   │   ├── useChatStream.ts       # Channel listener -> NDJSON parser -> chatStore dispatch
│   │   ├── useSession.ts         # Session CRUD, active session management
│   │   ├── useWorktree.ts        # Worktree operations
│   │   ├── useTeamWatcher.ts     # Filesystem watch for ~/.claude/tasks/
│   │   ├── useCostTracking.ts    # Per-session and aggregate cost queries
│   │   └── useKeyboardShortcuts.ts # Adapted from Pluribus
│   ├── lib/
│   │   ├── ndjson-parser.ts       # parseCLILine() + cliMessageToUIAction() mapper
│   │   ├── errors.ts             # AppError hierarchy (from Pluribus src/lib/errors.ts)
│   │   ├── cost.ts              # Pricing tables, cost calculation
│   │   └── format.ts            # Date, number, byte formatters
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx       # Sidebar + main content + overlays
│   │   │   └── Sidebar.tsx        # Collapsible left panel
│   │   ├── chat/
│   │   │   ├── ChatPanel.tsx      # Message list + input (main interface)
│   │   │   ├── ChatInput.tsx      # Multi-line input, Cmd+Enter to send
│   │   │   ├── MessageBubble.tsx  # Single message with markdown rendering
│   │   │   ├── StreamingMessage.tsx # In-progress message with cursor
│   │   │   ├── ToolCallCard.tsx   # Collapsible tool invocation display
│   │   │   └── ToolResultCard.tsx # Tool result with syntax highlighting
│   │   ├── session/
│   │   │   ├── SessionSidebar.tsx # Session list with status dots + cost
│   │   │   ├── SessionItem.tsx
│   │   │   └── NewSessionDialog.tsx # Project, model, autonomy selection
│   │   ├── team/
│   │   │   ├── TeamDashboard.tsx  # Agent grid with status cards
│   │   │   ├── AgentCard.tsx
│   │   │   ├── TaskBoard.tsx     # Column-based task visualization
│   │   │   └── TaskCard.tsx
│   │   ├── diff/
│   │   │   ├── DiffReviewPanel.tsx # Grouped file changes, accept/reject
│   │   │   └── DiffFileCard.tsx
│   │   ├── permission/
│   │   │   └── PermissionPrompt.tsx # Modal approve/deny for tool use
│   │   └── common/                  # Reused from Pluribus
│   │       ├── Button.tsx
│   │       ├── StatusBadge.tsx
│   │       ├── DataTable.tsx
│   │       ├── JsonViewer.tsx
│   │       └── CostTrackingPanel.tsx
│   └── pages/
│       ├── ChatPage.tsx
│       ├── TeamPage.tsx
│       ├── SettingsPage.tsx
│       └── ProjectsPage.tsx
├── index.html
├── vite.config.ts
├── package.json
└── CLAUDE.md
```

---

## 3. SQLite Schema (Drizzle ORM)

```typescript
// src/db/schema.ts

import { sqliteTable, text, integer, real, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  path: text('path').notNull().unique(),
  defaultModel: text('default_model').default('sonnet'),
  defaultAutonomy: text('default_autonomy').default('supervised'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  status: text('status').notNull().default('created'),
  claudeSessionId: text('claude_session_id'),
  model: text('model').notNull().default('sonnet'),
  autonomyLevel: text('autonomy_level').default('supervised'),
  worktreePath: text('worktree_path'),
  worktreeBranch: text('worktree_branch'),
  allowedTools: text('allowed_tools'),        // JSON array
  systemPromptAppend: text('system_prompt_append'),
  maxTurns: integer('max_turns'),
  maxBudgetUsd: real('max_budget_usd'),
  totalCostUsd: real('total_cost_usd').default(0),
  totalInputTokens: integer('total_input_tokens').default(0),
  totalOutputTokens: integer('total_output_tokens').default(0),
  turnCount: integer('turn_count').default(0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_sessions_project').on(t.projectId),
  index('idx_sessions_status').on(t.status),
]);

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  role: text('role').notNull(),               // user|assistant|system|tool_use|tool_result
  content: text('content').notNull(),
  contentType: text('content_type').default('text'),
  toolName: text('tool_name'),
  toolInput: text('tool_input'),              // JSON
  toolUseId: text('tool_use_id'),
  isError: integer('is_error', { mode: 'boolean' }).default(false),
  model: text('model'),
  inputTokens: integer('input_tokens'),
  outputTokens: integer('output_tokens'),
  costUsd: real('cost_usd'),
  orderIndex: integer('order_index').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
  index('idx_messages_session_order').on(t.sessionId, t.orderIndex),
]);

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  projectId: text('project_id').references(() => projects.id),
  name: text('name').notNull(),
  status: text('status').default('idle'),
  claudeTeamDir: text('claude_team_dir'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  teamId: text('team_id').references(() => teams.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  status: text('status').default('pending'),
  assignedAgent: text('assigned_agent'),
  dependencies: text('dependencies'),         // JSON array of task IDs
  filePath: text('file_path'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const usageRecords = sqliteTable('usage_records', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'cascade' }).notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  costUsd: real('cost_usd').notNull(),
  timestamp: text('timestamp').notNull().default(sql`(datetime('now'))`),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});
```

---

## 4. NDJSON Stream Parser

The Claude CLI with `--output-format stream-json --verbose` emits NDJSON with these types:

| CLI Type | Subtype | UI Action |
|----------|---------|-----------|
| `system` | `init` | Store session_id, model, available tools |
| `stream_event` | `content_block_delta` (text_delta) | Append token to streaming message |
| `stream_event` | `content_block_delta` (thinking_delta) | Append to thinking block |
| `stream_event` | `content_block_start` (tool_use) | Start tool call card |
| `stream_event` | `content_block_delta` (input_json_delta) | Accumulate tool input |
| `assistant` | -- | Finalize complete assistant turn |
| `user` | tool_result | Add tool result card |
| `result` | success/error | Mark session complete, store costs |

### TypeScript Types

```typescript
// src/types/cli.ts
type CLIMessage = SystemMessage | AssistantMessage | UserMessage | StreamEvent | ResultMessage;

interface SystemMessage {
  type: 'system';
  subtype: 'init';
  session_id: string;
  model: string;
  tools: { name: string }[];
  mcp_servers: { name: string; status: string }[];
}

interface AssistantMessage {
  type: 'assistant';
  message: {
    content: (TextBlock | ToolUseBlock | ThinkingBlock)[];
    model: string;
    usage: { input_tokens: number; output_tokens: number };
  };
}

interface StreamEvent {
  type: 'stream_event';
  event: {
    type: 'content_block_delta' | 'content_block_start' | 'content_block_stop' | 'message_delta' | 'message_stop';
    delta?: { type: string; text?: string; thinking?: string; partial_json?: string };
    // ...
  };
}

interface ResultMessage {
  type: 'result';
  subtype: 'success' | 'error';
  session_id: string;
  total_cost_usd: number;
  duration_ms: number;
  num_turns: number;
}
```

### Parser Pipeline

```
claude CLI stdout
    -> Rust BufReader::lines() (line splitting)
    -> Channel<String>.send() (IPC to frontend)
    -> parseCLILine() (JSON.parse + type discrimination)
    -> cliMessageToUIAction() (map to store actions)
    -> chatStore.dispatch() (update React state)
```

---

## 5. IPC Protocol

### Tauri Commands (invoke)

```typescript
// Session lifecycle
'create_session':    (input: CreateSessionInput) => SessionSummary
'list_sessions':     (projectId?: string) => SessionSummary[]
'delete_session':    (id: string) => void

// Chat (spawns CLI process, streams via Channel)
'send_message':      (sessionId: string, message: string, channel: Channel<string>) => void
'abort_session':     (sessionId: string) => void
'resume_session':    (sessionId: string, message?: string, channel: Channel<string>) => void

// Projects
'open_project':      (path: string) => Project
'list_projects':     () => Project[]

// Worktrees
'create_worktree':   (projectPath: string, sessionId: string, baseBranch?: string) => WorktreeInfo
'remove_worktree':   (projectPath: string, worktreePath: string, deleteBranch: boolean) => void

// Teams
'create_team':       (input: CreateTeamInput) => Team
'start_team':        (teamId: string, prompt: string, channel: Channel<string>) => void
'get_team_tasks':    (teamDir: string) => TeamTask[]

// Settings + DB proxy
'get_settings':      () => AppSettings
'update_settings':   (updates: Partial<AppSettings>) => AppSettings
'execute_sql':       (sql: string, params: unknown[]) => void
'select_sql':        (sql: string, params: unknown[]) => unknown[]
```

### Tauri Events (listen)

```typescript
'session-status-changed': { sessionId: string; status: SessionStatus }
'permission-request':     { requestId: string; sessionId: string; toolName: string; toolInput: Record<string, unknown> }
```

### Tauri Channels (per-session streaming)

```typescript
const channel = new Channel<string>();
channel.onmessage = (line) => {
  const msg = parseCLILine(line);
  if (msg) cliMessageToUIAction(msg).forEach(action => chatStore.dispatch(action));
};
await invoke('send_message', { sessionId, message: input, channel });
```

---

## 6. Session Lifecycle

```
Created -> (send_message) -> Running -> (exit 0) -> Completed
                                |                       |
                           (abort) -> Killed     (resume) -> Running
                                |
                           (exit != 0) -> Failed -> (resume) -> Running
                                |
                           (pause) -> Paused -> (resume) -> Running
```

CLI arguments per session:
```
claude --print --output-format stream-json --verbose
  [--resume <claude_session_id>]
  [--model <model>]
  [--max-turns <n>]
  [--max-budget-usd <n>]
  [--allowedTools <tools>]
  [--append-system-prompt <text>]
  [--permission-prompt-tool <mcp_tool>]
```

---

## 7. Git Worktree Management

- **Branch naming:** `pluribus/<session-short-id>` (e.g., `pluribus/a1b2c3d4`)
- **Worktree path:** `<repo>/../.pluribus-worktrees/<session-short-id>` (sibling of repo)
- **Create:** `git -C <repo> worktree add -b pluribus/<id> <path> [<base-branch>]`
- **Remove:** `git -C <repo> worktree remove <path>` + `git branch -D pluribus/<id>`
- **Cleanup:** `git worktree prune` + remove orphaned `.pluribus-worktrees/` dirs
- **Auto-cleanup:** Configurable, remove completed session worktrees after 24h

---

## 8. Agent Teams Integration

Teams use `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` env var on the lead agent process.

The app monitors filesystem state:
- `~/.claude/teams/<team-id>/config.json` -> team metadata, agent list
- `~/.claude/tasks/<team-id>/*.json` -> individual task status

`useTeamWatcher` hook uses filesystem polling to sync task state to SQLite `tasks` table and `teamStore`.

---

## 9. Permission System

Three autonomy levels:

| Level | `--allowedTools` | Permission MCP |
|-------|------------------|----------------|
| `ask` | (none) | Active — all tools need approval |
| `supervised` | `Read,Glob,Grep,WebFetch,WebSearch` | Active for writes only |
| `autonomous` | All tools | Not used |

When active, a tiny MCP stdio server runs as a sidecar. Claude CLI sends permission requests via `--permission-prompt-tool`. The server forwards them as Tauri events -> `PermissionPrompt` modal -> user approves/denies -> response sent back.

---

## 10. Reuse From Existing Pluribus

| Source File | Target | Strategy |
|------------|--------|----------|
| `frontend/src/components/Button.tsx` | `src/components/common/Button.tsx` | Copy directly |
| `frontend/src/components/StatusBadge.tsx` | `src/components/common/StatusBadge.tsx` | Copy, extend statuses |
| `frontend/src/components/DataTable.tsx` | `src/components/common/DataTable.tsx` | Copy directly |
| `frontend/src/components/JsonViewer.tsx` | `src/components/common/JsonViewer.tsx` | Copy directly |
| `frontend/src/components/workflow/CostTrackingPanel.tsx` | `src/components/common/CostTrackingPanel.tsx` | Adapt: sessionId prop |
| `frontend/src/hooks/useKeyboardShortcuts.ts` | `src/hooks/useKeyboardShortcuts.ts` | Adapt shortcuts |
| `frontend/src/stores/workflowBuilderStore.ts` | Pattern for chatStore | Zustand pattern reference |
| `frontend/src/api/client.ts` | `src/ipc/commands.ts` | Replace fetch->invoke |
| `frontend/src/hooks/useSSE.ts` | `src/ipc/channels.ts` | Replace EventSource->Channel |
| `src/integrations/adapters/claude-code.ts` | `src-tauri/src/process/manager.rs` | Rust port of spawn+parse |
| `src/lib/errors.ts` | `src/lib/errors.ts` | Simplify |

**Not carrying over:** Hono API, PostgreSQL, Redis, BullMQ, DAG workflow engine, WorkflowCanvas, Docker runtime, triggers/scheduler.

---

## 11. Implementation Phases

### Phase 1: Core Chat (Weeks 1-3)
**Goal:** Single session chat with Claude CLI, NDJSON parsing, streaming display.

1. Initialize Tauri 2.0 project (React + Vite + TS)
2. Set up tauri-plugin-shell + tauri-plugin-sql (SQLite)
3. Create SQLite schema (all tables)
4. Implement Drizzle sqlite-proxy client
5. Build Rust ProcessManager (spawn, BufReader->Channel streaming)
6. Build Rust SessionHandle (state machine, stdin, kill)
7. Build NDJSON parser (all CLIMessage types + UIAction mapper)
8. Build Zustand stores (session, chat, settings)
9. Build ChatPanel, ChatInput, MessageBubble, StreamingMessage
10. Build ToolCallCard + ToolResultCard
11. Build SessionSidebar + AppShell layout
12. Copy common components from Pluribus
13. Implement check_claude_cli for onboarding
14. Build ipc/commands.ts (type-safe invoke wrappers)

### Phase 2: Multi-Session + Worktrees (Weeks 4-5)
**Goal:** Multiple concurrent sessions, project management, worktree isolation.

1. Extend ProcessManager for concurrent sessions (HashMap)
2. Build NewSessionDialog (project, model, autonomy)
3. Implement project management commands
4. Build WorktreeManager in Rust
5. Wire worktree creation into session flow
6. Implement session resume (--resume)
7. Implement session pause
8. Build CostTrackingPanel (adapted)
9. Build useCostTracking hook

### Phase 3: Agent Teams + Orchestration (Weeks 6-8)
**Goal:** Spawn Agent Teams, visualize tasks, team dashboard.

1. Team creation with CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS env
2. Build useTeamWatcher (filesystem polling)
3. Sync task JSONs to SQLite
4. Build TeamDashboard (AgentCard grid)
5. Build TaskBoard (columns by status)
6. Build TaskCard
7. Build team creation wizard

### Phase 4: Diff Review (Weeks 9-10)
**Goal:** Review file changes made by agents.

1. Build DiffReviewPanel (slide-over)
2. Extract diffs from Edit/Write tool messages
3. Build DiffFileCard with unified diff
4. Accept/reject per-file and bulk
5. "Open in Editor" integration

### Phase 5: Permission System + Polish (Weeks 11-12)
**Goal:** Permission MCP server, shortcuts, settings, production.

1. MCP stdio permission server (Rust)
2. PermissionPrompt modal
3. Three-level autonomy implementation
4. SettingsPage
5. Keyboard shortcuts
6. Dark mode
7. Virtualized message list
8. Cross-platform testing
9. App icon, branding, onboarding

---

## 12. Verification Plan

### After Phase 1:
- Launch app, single chat session works end-to-end
- Streaming response with markdown rendering
- Tool calls display as collapsible cards
- Session persists in SQLite across restart
- `cargo tauri dev`

### After Phase 2:
- 3 concurrent sessions on different repos
- Each in its own git worktree
- Pause/resume preserves conversation
- Cost tracking per turn

### After Phase 3:
- Agent Team spawns successfully
- Task board populates as agents claim tasks
- Agent status cards update in real-time

### After Phase 4:
- Session edits files -> DiffReviewPanel shows all changes
- Accept/reject individual files

### After Phase 5:
- Autonomy levels work (ask/supervised/autonomous)
- Keyboard shortcuts functional
- Production bundle: `bun run tauri build`

---

## Key Dependencies

**Runtime & Tooling:**
- `bun` — JS runtime, package manager, test runner. Used for all frontend dev, builds, and scripts.

**Rust (Cargo.toml):**
- `tauri = "2"`, `tauri-plugin-shell = "2"`, `tauri-plugin-sql = "2"` (features: sqlite)
- `tauri-plugin-fs = "2"`, `tokio`, `serde`, `serde_json`

**Frontend (package.json, managed via `bun install`):**
- `@tauri-apps/api`, `@tauri-apps/plugin-shell`, `@tauri-apps/plugin-sql`
- `react@19`, `react-router-dom@7`, `zustand@5`, `@tanstack/react-query@5`
- `drizzle-orm` (sqlite-proxy), `tailwindcss@4`, `vite`
- `react-markdown` (streaming-safe MD rendering)

**Development Commands:**
```bash
bun install                   # Install frontend dependencies
bun run tauri dev             # Start dev mode (Rust + Vite + WebView)
bun run dev                   # Vite frontend only
bun run test                  # Run Vitest
bun run tauri build           # Production binary
```
