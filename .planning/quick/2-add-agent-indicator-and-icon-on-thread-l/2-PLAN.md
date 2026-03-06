---
phase: quick
plan: 2
type: execute
wave: 1
depends_on: []
files_modified:
  - src/components/assistant-ui/thread-list.tsx
  - src/lib/orchestration/orchestrated-adapter.ts
autonomous: true
requirements: [QUICK-2]

must_haves:
  truths:
    - "Each thread list item shows a small agent icon (BotIcon for Claude, BrainCircuitIcon for Codex) inline"
    - "Hovering a thread item shows a tooltip with model label, provider type, and family"
    - "When a new message is sent, the thread's model field is updated in the DB"
    - "Thread list reflects the model icon after a message is sent"
  artifacts:
    - path: "src/components/assistant-ui/thread-list.tsx"
      provides: "ThreadModelIcon component and modelId sourced from thread row"
    - path: "src/lib/orchestration/orchestrated-adapter.ts"
      provides: "Model persistence on thread row during message send"
  key_links:
    - from: "src/lib/orchestration/orchestrated-adapter.ts"
      to: "db.threads.updateModel"
      via: "write resolved model to thread row on each run"
      pattern: "db\\.threads\\.updateModel"
    - from: "src/components/assistant-ui/thread-list.tsx"
      to: "ThreadRow.model"
      via: "read model from thread row instead of usage_snapshots"
      pattern: "row\\.model"
---

<objective>
Add a visible agent icon on each thread list item in the sidebar, enhance the existing hover tooltip, fix model data source to use the thread row (usage_snapshots is never populated), and ensure the orchestrated adapter persists the resolved model on each message send.

Purpose: Users need to see at a glance which agent/model a thread is using without hovering, and model info needs to actually be populated for both new and existing threads.
Output: Visible agent icons on thread list items, working model persistence pipeline.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/components/assistant-ui/thread-list.tsx
@src/lib/orchestration/orchestrated-adapter.ts
@src/lib/models.ts
@src/lib/db.ts

<interfaces>
From src/lib/models.ts:
```typescript
export function getModelById(id: string): ClaudeModel | CodexModel | undefined;
export function isCodexModel(id: string): boolean;
// ClaudeModel has: id, alias, label, family, supportsEffort
// CodexModel has: id, label, family, supportsEffort
```

From src/lib/db.ts:
```typescript
export interface ThreadRow {
  model: string | null;        // <-- thread's model ID, set by user selection
  provider_type: string | null; // <-- "agent-sdk" | "codex" | null
  // ... other fields
}
// db.threads.updateModel(id, model) — sets model on thread row
// db.threads.get(remoteId) — returns ThreadRow | null
// db.usageSnapshots.getLatest(threadId) — returns UsageSnapshotRow | null (BUT never populated)
```

From thread-list.tsx (existing):
```typescript
type ThreadMetaSnapshot = {
  workspaceId: string | null;
  cwd: string | null;
  gitBranch: string | null;
  modelId: string | null;  // <-- currently sourced from usageRow?.model_id (always null)
};

// ThreadDetailsTooltip already shows modelId on hover
// ThreadStatusIcon shows running/error/completed status icons
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix model data source and add inline agent icon to thread list items</name>
  <files>src/components/assistant-ui/thread-list.tsx</files>
  <action>
Three changes to thread-list.tsx:

1. **Fix modelId data source**: In the `loadThreadMeta` effect (around line 297), change `modelId: usageRow?.model_id ?? null` to `modelId: row.model ?? usageRow?.model_id ?? null`. This uses the thread row's `model` field as primary source (which is actually populated), falling back to usage_snapshots. Since usage_snapshots is never populated (usageSnapshots.insert is never called anywhere), the current code always returns null for modelId.

2. **Add ThreadModelIcon component**: Create a small inline component (similar pattern to ThreadStatusIcon) that renders a model icon next to the thread title. Import `BotIcon` and `BrainCircuitIcon` from lucide-react (already imported in thread.tsx but not thread-list.tsx). The component:
   - Takes `modelId: string | null` prop
   - If modelId is null, render nothing
   - If `isCodexModel(modelId)`, render `<BrainCircuitIcon className="size-3 shrink-0 text-muted-foreground" />`
   - Otherwise render `<BotIcon className="size-3 shrink-0 text-muted-foreground" />`
   - Import `isCodexModel` from `@/lib/models`

3. **Place the icon in both thread list locations**: In both the workspace threads section (around line 770) and the unassigned threads section (around line 880), add the ThreadModelIcon inside the thread row button, before the title span. The structure inside the button should be:
   ```tsx
   <button ... className="h-9 min-w-0 flex-1 px-2 text-left">
     <span className="flex items-center gap-1.5">
       <ThreadModelIcon modelId={threadMeta?.modelId ?? null} />
       <span className="block truncate text-sm">{thread.title ?? "New Thread"}</span>
     </span>
   </button>
   ```

4. **Enhance ThreadDetailsTooltip**: Update the model display in ThreadDetailsTooltip to show the human-readable model label instead of raw model ID. Import `getModelById` from `@/lib/models`. Change the model line to:
   ```tsx
   const modelInfo = modelId ? getModelById(modelId) : undefined;
   const modelLabel = modelInfo?.label ?? modelId ?? "Default model";
   ```
   Also add provider type info below the model line if modelId exists:
   ```tsx
   {modelId ? (
     <div className="flex items-center gap-1.5 text-[11px]">
       <span className="text-background/70">Provider</span>
       <span className="truncate">{isCodexModel(modelId) ? "Codex" : "Agent SDK"}</span>
     </div>
   ) : null}
   ```
  </action>
  <verify>
    <automated>cd /home/user/projects/pluribus && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>Thread list items display a small BotIcon or BrainCircuitIcon inline before the title when modelId is present. Tooltip shows human-readable model label and provider type. modelId is sourced from ThreadRow.model (populated) instead of usage_snapshots (empty).</done>
</task>

<task type="auto">
  <name>Task 2: Persist resolved model to thread row on each message send</name>
  <files>src/lib/orchestration/orchestrated-adapter.ts</files>
  <action>
In `orchestrated-adapter.ts`, after the model is resolved with `resolveModel()` (line 46), add a call to persist the resolved model back to the thread row. This ensures that even threads created before the model field existed get backfilled on their next use.

After `const model = resolveModel(threadRow?.model ?? null);` (line 46), add:
```typescript
// Persist resolved model to thread row so thread list can display it
if (threadRow && threadRow.model !== model) {
  await db.threads.updateModel(threadRow.id, model);
}
```

This handles:
- **Backfill**: Old threads without a model set will get the resolved default written
- **New messages**: Every message send ensures the thread has the correct model persisted
- **No-op for unchanged**: Only writes when the value actually differs

Import `db` from `@/lib/db` if not already imported (check existing imports).
  </action>
  <verify>
    <automated>cd /home/user/projects/pluribus && npx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>The orchestrated adapter writes the resolved model to the thread's model field on each message send, ensuring thread list always has model data to display.</done>
</task>

</tasks>

<verification>
- TypeScript compiles with no errors: `npx tsc --noEmit`
- Thread list items show BotIcon/BrainCircuitIcon when model is set on the thread
- Hover tooltip shows human-readable model label (e.g., "Opus 4.6") and provider type
- After sending a message in a thread, the model icon appears in the sidebar
</verification>

<success_criteria>
- Thread list items display inline agent icons (Bot for Claude, BrainCircuit for Codex)
- Tooltip shows model label and provider type on hover
- Model data is sourced from ThreadRow.model (which is populated) not usage_snapshots (which is empty)
- Orchestrated adapter persists resolved model on each run, backfilling old threads
- TypeScript compiles cleanly
</success_criteria>

<output>
After completion, create `.planning/quick/2-add-agent-indicator-and-icon-on-thread-l/2-SUMMARY.md`
</output>
