# Frontend Components

## Entry & Layout
- **main.tsx** (9 lines) — React entry, renders App into #root
- **App.tsx** (25 lines) — Root: RuntimeProvider + ThreadWorkspace + lazy DevPanel (dev only)
- **RuntimeProvider.tsx** (39 lines) — useRemoteThreadListRuntime + createClaudeAdapter + SQLiteThreadListAdapter
- **ThreadWorkspace.tsx** (20 lines) — Flexbox: sidebar (w-72 ThreadList) + main (Thread)

## Chat UI (assistant-ui primitives) — src/components/assistant-ui/
- **thread.tsx** (378 lines) — Full chat: ThreadPrimitive, Composer, UserMessage, AssistantMessage (reasoning blocks, tool-calls, token metrics), PermissionApprovalBar, RunningElapsed timer
- **thread-list.tsx** (544 lines) — Workspace management, thread grouping, rename/archive/delete, AI title generation
- **markdown-text.tsx** (241 lines) — Markdown rendering with remark-gfm
- **tool-fallback.tsx** (322 lines) — Tool invocation display UI
- **tooltip-icon-button.tsx** (40 lines) — Reusable icon button

## Dev Panel
- **DevPanel.tsx** (461 lines) — Lazy-loaded, dev-only. Organized + Raw JSON modes. useSyncExternalStore subscription.

## UI Primitives (shadcn/ui) — src/components/ui/
button, dialog, tooltip, avatar, collapsible, skeleton, card, badge
