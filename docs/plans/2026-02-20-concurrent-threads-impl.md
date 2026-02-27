# Concurrent Thread Status & Multitasking Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add real-time per-thread status indicators (running/approval/error/unread) to the sidebar, plus toast notifications when background threads complete.

**Architecture:** A new Zustand store (`thread-status-store.ts`) holds a `Map<threadId, ThreadStatusRecord>`. The router adapter (`router-adapter.ts`) wraps its delegated `run()` generator to write `running`/`idle`/`error` transitions. The thread-list sidebar reads this store per-row and renders lucide icons. A `ThreadStatusToasts` component subscribes to transitions and fires sonner toasts for background threads. Codex approval detection hooks into the existing `codex-approval-store` flow.

**Tech Stack:** Zustand (already installed), sonner (needs `bun add sonner`), lucide-react (already installed), shadcn/ui

---

### Task 1: Create `src/lib/thread-status-store.ts`

**Files:**
- Create: `src/lib/thread-status-store.ts`

**Step 1: Write the file**

```typescript
import { create } from "zustand";

export type ThreadStatus = "idle" | "running" | "waiting-approval" | "error";

export interface ThreadStatusRecord {
  status: ThreadStatus;
  unread: boolean;
  title?: string;
  finishedAt?: number;
}

interface ThreadStatusState {
  statuses: Map<string, ThreadStatusRecord>;
  currentThreadId: string | null;
  setCurrentThread: (threadId: string | null) => void;
  setStatus: (threadId: string, status: ThreadStatus, title?: string) => void;
  markRead: (threadId: string) => void;
}

export const useThreadStatusStore = create<ThreadStatusState>((set, get) => ({
  statuses: new Map(),
  currentThreadId: null,

  setCurrentThread: (threadId) => set({ currentThreadId: threadId }),

  setStatus: (threadId, status, title) => {
    const { statuses, currentThreadId } = get();
    const existing = statuses.get(threadId) ?? { status: "idle", unread: false };
    const isTerminal = status === "idle" || status === "error";
    const isBackground = currentThreadId !== threadId;
    const next = new Map(statuses);
    next.set(threadId, {
      status,
      title: title ?? existing.title,
      unread: isTerminal && isBackground ? true : existing.unread,
      finishedAt: isTerminal ? Date.now() : existing.finishedAt,
    });
    set({ statuses: next });
  },

  markRead: (threadId) => {
    const { statuses } = get();
    const existing = statuses.get(threadId);
    if (!existing?.unread) return;
    const next = new Map(statuses);
    next.set(threadId, { ...existing, unread: false });
    set({ statuses: next });
  },
}));
```

**Step 2: Verify it compiles**

```bash
bun run build 2>&1 | grep -E "error|warning" | head -20
```
Expected: No TypeScript errors relating to `thread-status-store.ts`.

**Step 3: Commit**

```bash
git add src/lib/thread-status-store.ts
git commit -m "feat(thread-status): add thread status Zustand store"
```

---

### Task 2: Wrap `router-adapter.ts` to emit status transitions

**Files:**
- Modify: `src/lib/router-adapter.ts`

**Context:** Read `src/lib/router-adapter.ts` first. It's 39 lines. The `run()` generator reads the thread model from SQLite (`db.threads.get(threadKey)`) and then delegates to either the SDK or Codex adapter via `for await ... yield`. We need to:
1. Call `setStatus(threadKey, 'running', title)` before the loop
2. Call `setStatus(threadKey, 'idle')` after the loop
3. Call `setStatus(threadKey, 'error')` in a catch block

**Step 1: Replace `src/lib/router-adapter.ts` with the updated version**

```typescript
/**
 * Router adapter for assistant-ui.
 *
 * Reads the thread's model from SQLite on each run and delegates to either:
 * - agent-sdk-adapter (Claude models)
 * - codex-adapter (Codex models)
 *
 * The Codex adapter is created lazily on first Codex turn and reused after.
 */
import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";
import { createAgentSdkAdapter } from "@/lib/agent-sdk-adapter";
import { createCodexAdapter } from "@/lib/codex-adapter";
import { db } from "@/lib/db";
import { isCodexModel, DEFAULT_MODEL_ID } from "@/lib/models";
import { useThreadStatusStore } from "@/lib/thread-status-store";

export function createRouterAdapter(): ChatModelAdapter {
  const sdkAdapter = createAgentSdkAdapter();
  let codexInstance: ChatModelAdapter | null = null;

  return {
    async *run(options): AsyncGenerator<ChatModelRunResult, void> {
      const threadKey =
        (options as { unstable_threadId?: string }).unstable_threadId?.trim() ??
        "__global__";

      const row = await db.threads.get(threadKey);
      const modelId = row?.model ?? DEFAULT_MODEL_ID;
      const title = row?.title ?? undefined;

      const adapter = isCodexModel(modelId)
        ? (codexInstance ??= createCodexAdapter())
        : sdkAdapter;

      const { setStatus } = useThreadStatusStore.getState();
      setStatus(threadKey, "running", title);
      try {
        for await (const chunk of adapter.run(options) as AsyncIterable<ChatModelRunResult>) {
          yield chunk;
        }
        setStatus(threadKey, "idle", title);
      } catch (err) {
        setStatus(threadKey, "error", title);
        throw err;
      }
    },
  };
}
```

**Step 2: Verify it compiles**

```bash
bun run build 2>&1 | grep -E "TS[0-9]|error TS" | head -20
```
Expected: No new TypeScript errors.

**Step 3: Commit**

```bash
git add src/lib/router-adapter.ts
git commit -m "feat(thread-status): emit running/idle/error transitions in router adapter"
```

---

### Task 3: Wire current-thread tracking and unread markRead in `thread-list.tsx`

**Files:**
- Modify: `src/components/assistant-ui/thread-list.tsx`

**Context:** `switchToThread` is at line 530–535. `mainThreadId` is the active thread ID. We need two changes:
1. When `mainThreadId` changes, call `setCurrentThread` + `markRead`
2. When `switchToThread` is called, call `markRead` before switching

**Step 1: Add the import at the top of `thread-list.tsx` (after the existing imports)**

Find the import block (ends around line 39). Add:
```typescript
import { useThreadStatusStore } from "@/lib/thread-status-store";
```

**Step 2: Add a `useEffect` to sync `mainThreadId` into the store**

`mainThreadId` is read from `useAuiState` around line 152. Add an effect immediately after where `mainThreadId` is defined (look for the `const mainThreadId = ...` line):

```typescript
useEffect(() => {
  const { setCurrentThread, markRead } = useThreadStatusStore.getState();
  setCurrentThread(mainThreadId ?? null);
  if (mainThreadId) markRead(mainThreadId);
}, [mainThreadId]);
```

**Step 3: Update the `switchToThread` callback (lines 530–535)**

Replace:
```typescript
const switchToThread = useCallback(
  (threadId: string) => {
    aui.threads().switchToThread(threadId);
  },
  [aui],
);
```

With:
```typescript
const switchToThread = useCallback(
  (threadId: string) => {
    useThreadStatusStore.getState().markRead(threadId);
    aui.threads().switchToThread(threadId);
  },
  [aui],
);
```

**Step 4: Add `useEffect` to the imports in the existing React import line**

Check that `useEffect` is already in the React imports (line 39). It should already be there.

**Step 5: Verify it compiles**

```bash
bun run build 2>&1 | grep -E "TS[0-9]|error TS" | head -20
```

**Step 6: Commit**

```bash
git add src/components/assistant-ui/thread-list.tsx
git commit -m "feat(thread-status): sync current thread and markRead on navigation"
```

---

### Task 4: Add per-thread status icons and unread badge to thread rows

**Files:**
- Modify: `src/components/assistant-ui/thread-list.tsx`

**Context:** There are two thread row render sites in the file:
- **Workspace threads**: lines 689–764 (inside `threadsInWorkspace.map`)
- **Unassigned threads**: lines 798–872 (inside `threadGroups.unassigned.map`)

Both share the same structure. We add a `ThreadStatusIcon` component at the top of the file and use it in both places.

**Step 1: Add `AlertTriangleIcon` and `XCircleIcon` to the existing lucide import block (lines 21–36)**

Add to the existing lucide import:
```typescript
  AlertTriangleIcon,
  XCircleIcon,
```

**Step 2: Add `useShallow` import from zustand**

After the existing imports, add:
```typescript
import { useShallow } from "zustand/react/shallow";
```

**Step 3: Add `ThreadStatusIcon` component near the top of the file (after the type definitions, before the first function)**

```typescript
function ThreadStatusIcon({ threadId }: { threadId: string }) {
  const record = useThreadStatusStore(
    useShallow((s) => s.statuses.get(threadId)),
  );

  if (!record) return null;

  if (record.status === "running") {
    return (
      <LoaderCircleIcon className="size-3.5 shrink-0 animate-spin text-muted-foreground" />
    );
  }
  if (record.status === "waiting-approval") {
    return (
      <AlertTriangleIcon className="size-3.5 shrink-0 animate-pulse text-yellow-500" />
    );
  }
  if (record.status === "error") {
    return <XCircleIcon className="size-3.5 shrink-0 text-destructive" />;
  }
  if (record.status === "idle" && record.unread) {
    return <span className="size-2 shrink-0 rounded-full bg-primary" />;
  }
  return null;
}
```

**Step 4: Add `ThreadStatusIcon` to workspace thread rows**

In the workspace thread row (around line 737, the `aui-thread-row-actions` div), the icon should appear **before** the actions div and **always visible** (not hidden on hover). Modify the row structure. Find:

```typescript
                            <div className="aui-thread-row-actions mr-1 flex items-center opacity-0 transition-opacity group-hover:opacity-100 data-[active=true]:opacity-100">
```

Add the icon just before this div:
```typescript
                            <div className="mr-1 flex items-center">
                              <ThreadStatusIcon threadId={thread.id} />
                            </div>
                            <div className="aui-thread-row-actions mr-1 flex items-center opacity-0 transition-opacity group-hover:opacity-100 data-[active=true]:opacity-100">
```

**Step 5: Add `ThreadStatusIcon` to unassigned thread rows**

Same pattern in the unassigned rows section (around line 844, just before the `aui-thread-row-actions` div in the unassigned section):
```typescript
                      <div className="mr-1 flex items-center">
                        <ThreadStatusIcon threadId={thread.id} />
                      </div>
                      <div className="aui-thread-row-actions mr-1 flex items-center opacity-0 transition-opacity group-hover:opacity-100 data-[active=true]:opacity-100">
```

**Step 6: Verify it compiles**

```bash
bun run build 2>&1 | grep -E "TS[0-9]|error TS" | head -20
```

**Step 7: Manual smoke test**

```bash
cargo tauri dev
```

Start a message on one thread, then switch to another. The first thread should show a spinner. When it completes while you're on another thread, the spinner should turn into a blue dot. Clicking back to the first thread should clear the dot.

**Step 8: Commit**

```bash
git add src/components/assistant-ui/thread-list.tsx
git commit -m "feat(thread-status): add per-thread status icons and unread badge to sidebar"
```

---

### Task 5: Wire Codex `approval_needed` → `waiting-approval` status

**Files:**
- Modify: `src/lib/codex-adapter.ts`
- Modify: `src/components/assistant-ui/approval-banner.tsx`

**Context:** When Codex emits an `approval_needed` event, the current code in `codex-adapter.ts` (around line 254) pushes to `useCodexApprovalStore`. We add a `setStatus` call there. When the user responds (Allow/Deny) in `approval-banner.tsx`, the `respondToApproval` function dismisses the approval. At that point we revert to `running` (the Codex run continues processing after the user responds).

**Step 1: Read `src/lib/codex-adapter.ts` lines 250–265 to verify the exact location**

Look for the `case "approval_needed":` switch arm.

**Step 2: Add status import to `codex-adapter.ts`**

Near the top of the file, add:
```typescript
import { useThreadStatusStore } from "@/lib/thread-status-store";
```

**Step 3: Update the `approval_needed` case in `codex-adapter.ts`**

Find:
```typescript
      case "approval_needed": {
        useCodexApprovalStore.getState().push({
          thread_id: event.thread_id,
          approval_id: event.approval_id,
          command: event.command,
          reason: event.reason,
        });
        break;
      }
```

Replace with:
```typescript
      case "approval_needed": {
        useCodexApprovalStore.getState().push({
          thread_id: event.thread_id,
          approval_id: event.approval_id,
          command: event.command,
          reason: event.reason,
        });
        useThreadStatusStore.getState().setStatus(event.thread_id, "waiting-approval");
        break;
      }
```

**Step 4: Update `approval-banner.tsx` to revert status to `running` on respond**

Read `src/components/assistant-ui/approval-banner.tsx`. The `respondToApproval` function (lines 6–9) calls `codex_approve_tool` then dismisses from the approval store.

Add status import:
```typescript
import { useThreadStatusStore } from "@/lib/thread-status-store";
```

Update `respondToApproval`:
```typescript
async function respondToApproval(approvalId: string, allow: boolean, threadId: string) {
  await invoke("codex_approve_tool", { approvalId, allow });
  useCodexApprovalStore.getState().dismiss(approvalId);
  useThreadStatusStore.getState().setStatus(threadId, "running");
}
```

Update the `ApprovalBanner` component to pass `thread_id` to `respondToApproval`:

```typescript
        <Button
          size="sm"
          variant="outline"
          onClick={() => respondToApproval(pending.approval_id, false, pending.thread_id)}
        >
          Deny
        </Button>
        <Button
          size="sm"
          onClick={() => respondToApproval(pending.approval_id, true, pending.thread_id)}
        >
          Allow
        </Button>
```

**Step 5: Verify it compiles**

```bash
bun run build 2>&1 | grep -E "TS[0-9]|error TS" | head -20
```

**Step 6: Commit**

```bash
git add src/lib/codex-adapter.ts src/components/assistant-ui/approval-banner.tsx
git commit -m "feat(thread-status): set waiting-approval state on Codex approval events"
```

---

### Task 6: Add sonner toasts for background thread transitions

**Files:**
- Run: `bun add sonner`
- Create: `src/components/ThreadStatusToasts.tsx`
- Modify: `src/components/RuntimeProvider.tsx`

**Context:** Sonner is the toast library for shadcn/ui. It requires a `<Toaster />` component in the tree and exposes a `toast()` function called imperatively. We create a `ThreadStatusToasts` component (renders `null`, fires toasts as side effects) and mount it in `RuntimeProvider` alongside `ApprovalBanner`.

**Step 1: Install sonner**

```bash
cd /home/user/projects/pluribus && bun add sonner
```

Expected: sonner added to `package.json`.

**Step 2: Create `src/components/ThreadStatusToasts.tsx`**

```typescript
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useAui } from "@assistant-ui/react";
import {
  useThreadStatusStore,
  type ThreadStatusRecord,
} from "@/lib/thread-status-store";

export function ThreadStatusToasts() {
  const aui = useAui();
  const prevRef = useRef<Map<string, ThreadStatusRecord>>(
    new Map(useThreadStatusStore.getState().statuses),
  );

  useEffect(() => {
    return useThreadStatusStore.subscribe((state) => {
      const { statuses, currentThreadId } = state;
      const prev = prevRef.current;

      for (const [threadId, record] of statuses) {
        const prevRecord = prev.get(threadId);
        if (!prevRecord) continue;
        if (threadId === currentThreadId) continue;

        const label = record.title ?? "A thread";

        if (prevRecord.status === "running" && record.status === "idle") {
          toast(`${label} finished`, {
            duration: 4000,
            action: {
              label: "View",
              onClick: () => aui.threads().switchToThread(threadId),
            },
          });
        } else if (prevRecord.status === "running" && record.status === "error") {
          toast.error(`${label} errored`, {
            action: {
              label: "View",
              onClick: () => aui.threads().switchToThread(threadId),
            },
          });
        } else if (
          prevRecord.status !== "waiting-approval" &&
          record.status === "waiting-approval"
        ) {
          toast.warning(`${label} needs your approval`, {
            action: {
              label: "Go",
              onClick: () => aui.threads().switchToThread(threadId),
            },
          });
        }
      }

      prevRef.current = new Map(statuses);
    });
  }, [aui]);

  return null;
}
```

**Step 3: Update `RuntimeProvider.tsx`**

Add imports:
```typescript
import { Toaster } from "sonner";
import { ThreadStatusToasts } from "@/components/ThreadStatusToasts";
```

Update the JSX to include both (inside `AssistantRuntimeProvider` so `useAui()` works):
```typescript
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>{children}</TooltipProvider>
      <ApprovalBanner />
      <ThreadStatusToasts />
      <Toaster richColors position="bottom-right" />
    </AssistantRuntimeProvider>
  );
```

**Step 4: Verify it compiles**

```bash
bun run build 2>&1 | grep -E "TS[0-9]|error TS" | head -20
```

**Step 5: Manual smoke test**

```bash
cargo tauri dev
```

1. Start a message on Thread A
2. Immediately switch to Thread B
3. When Thread A finishes, expect a toast "Thread A finished" with a "View" button
4. Click "View" — should switch back to Thread A
5. The unread dot on Thread A should clear

**Step 6: Commit**

```bash
git add src/components/ThreadStatusToasts.tsx src/components/RuntimeProvider.tsx package.json bun.lockb
git commit -m "feat(thread-status): add sonner toasts for background thread transitions"
```

---

## Out of Scope (Deferred)

- **Agent SDK approval detection** — The sidecar protocol (`sidecar/agent-sdk-bridge/index.ts`) has no approval message type. Adding approval support requires: (1) finding the `@anthropic-ai/claude-agent-sdk` callback for tool approval, (2) adding `approval_request`/`approve` message types to the sidecar NDJSON protocol, (3) implementing handling in `agent-sdk-adapter.ts`. Track this separately.
- **Shell adapter approval** — Claude CLI stream approval detection
- **Queued state** — User opted out
- **Inline approve/deny from sidebar** — User opted for must-switch-to-thread flow
