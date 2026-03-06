---
phase: quick
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - src/components/assistant-ui/thread.tsx
autonomous: true
requirements: [QUICK-1]
must_haves:
  truths:
    - "Each assistant message shows an icon indicating which agent/model produced it"
    - "Hovering the icon reveals a tooltip with model name, family, and provider type"
  artifacts:
    - path: "src/components/assistant-ui/thread.tsx"
      provides: "AgentBadge component rendered in assistant message footer"
  key_links:
    - from: "src/components/assistant-ui/thread.tsx (AgentBadge)"
      to: "src/lib/models.ts (getModelById)"
      via: "import and lookup"
      pattern: "getModelById"
---

<objective>
Add a small agent icon/badge to each assistant message that shows which model produced the response, with a hover tooltip showing full details (model name, family, provider type).

Purpose: Users running multiple agents need to quickly identify which model generated each response.
Output: Updated thread.tsx with AgentBadge component in assistant message footer.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@src/components/assistant-ui/thread.tsx
@src/lib/models.ts
@src/lib/db.ts (ThreadRow — model, provider_type fields)
@src/components/RuntimeProvider.tsx

<interfaces>
From src/lib/models.ts:
```typescript
export interface ClaudeModel {
  id: string;
  alias: string;
  label: string;
  family: "4.6" | "4.5";
  supportsEffort: boolean;
}
export interface CodexModel {
  id: string;
  label: string;
  family: string;
  supportsEffort: boolean;
}
export function getModelById(id: string): ClaudeModel | CodexModel | undefined;
export function isCodexModel(id: string): boolean;
```

From src/lib/db.ts (ThreadRow):
```typescript
export interface ThreadRow {
  model: string | null;
  provider_type: string | null;
  // ... other fields
}
```

From assistant-ui:
```typescript
// useAuiState gives access to message metadata
const metadata = useAuiState(({ message }) => message.metadata);
// threadListItem gives thread ID for DB lookups
const remoteId = useAuiState(({ threadListItem }) => threadListItem.remoteId);
```

Existing pattern in thread.tsx — AssistantMessage footer area (line ~922):
```tsx
<div className="aui-assistant-message-footer mt-1 ml-2 flex items-center gap-3">
  <AssistantActionBar />
  <AssistantMessageMetrics />
</div>
```

Existing Tooltip usage in thread-list.tsx:
```tsx
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add AgentBadge component to assistant messages</name>
  <files>src/components/assistant-ui/thread.tsx</files>
  <action>
Create an `AgentBadge` component in thread.tsx and render it in the `AssistantMessage` footer alongside `AssistantActionBar` and `AssistantMessageMetrics`.

The component should:

1. Read the thread's model from DB using the existing pattern (useAuiState to get remoteId, then db.threads.get to fetch model). Use the same async load + cancelled pattern already used throughout the file (e.g., ComposerAction lines 657-674).

2. Use `getModelById` (already imported) and `isCodexModel` (already imported) to resolve the model details.

3. Render a small icon using lucide icons already in the project:
   - For Claude models: Use `BotIcon` from lucide-react (add to imports)
   - For Codex models: Use `BrainCircuitIcon` from lucide-react (add to imports)
   - If model is unknown/null: don't render anything

4. Wrap the icon in a `Tooltip` (from `@/components/ui/tooltip`, already used in thread-list.tsx) that shows on hover:
   - Model label (e.g., "Opus 4.6")
   - Provider type: "Agent SDK" for Claude models, "Codex" for Codex models
   - Model family (e.g., "4.6", "5.3")

5. Style the icon to match the existing muted aesthetic of the footer area:
   - `size-3.5 text-muted-foreground` on the icon
   - The tooltip should use the same style as ThreadDetailsTooltip in thread-list.tsx: `TooltipContent` with `side="top"` and a small grid of details

6. Place AgentBadge BEFORE `AssistantActionBar` in the footer div so it appears on the left side:
```tsx
<div className="aui-assistant-message-footer mt-1 ml-2 flex items-center gap-3">
  <AgentBadge />
  <AssistantActionBar />
  <AssistantMessageMetrics />
</div>
```

Import additions needed:
- Add `BotIcon, BrainCircuitIcon` to the lucide-react import
- Add `Tooltip, TooltipContent, TooltipTrigger` from `@/components/ui/tooltip`
  </action>
  <verify>
    <automated>cd /home/user/projects/pluribus && bunx tsc --noEmit 2>&1 | head -30</automated>
  </verify>
  <done>Assistant messages display a small agent icon in the footer. Hovering the icon shows model name, provider type, and family. Claude and Codex models show distinct icons. No icon shown when model is unknown.</done>
</task>

</tasks>

<verification>
- `bunx tsc --noEmit` passes with no errors
- Visual: Open app, send a message, verify agent badge appears in assistant message footer with correct hover tooltip
</verification>

<success_criteria>
- Each assistant message shows a small model icon in its footer area
- Hovering the icon reveals model label, provider type, and family
- Claude models show BotIcon, Codex models show BrainCircuitIcon
- No regressions in existing assistant message rendering
- TypeScript compiles cleanly
</success_criteria>

<output>
After completion, create `.planning/quick/1-add-agent-icon-with-on-hover-details-for/1-SUMMARY.md`
</output>
