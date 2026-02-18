# Permission UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a tool permission approval system that intercepts Claude CLI tool_use events during streaming, shows an approval UI, and supports a global Shift+Tab toggle for auto-accept mode.

**Architecture:** The adapter's stream processing loop (`for await` over `spawnClaudeStreaming`) will check each `content_block_start` with `type: "tool_use"` against an `autoAcceptMode` flag. When off, it creates a `ClaudePermissionRequest` and awaits a promise that resolves on user action. The existing `PermissionApprovalBar` component subscribes via `useSyncExternalStore` and displays approval/deny UI. A global Shift+Tab keydown listener toggles auto-accept mode with a toast notification.

**Tech Stack:** React 19, Tailwind CSS v4, shadcn/ui, Tauri shell plugin, sonner (toast), assistant-ui v0.12

---

### Task 1: Install sonner toast library

No toast library exists in the project. We need one for Shift+Tab toggle notifications.

**Files:**
- Modify: `package.json`
- Create: `src/components/ui/sonner.tsx`
- Modify: `src/App.tsx`

**Step 1: Install sonner**

Run: `bun add sonner`

**Step 2: Create the shadcn sonner wrapper**

Create `src/components/ui/sonner.tsx`:

```tsx
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
```

**Step 3: Mount Toaster in App.tsx**

In `src/App.tsx`, add `import { Toaster } from "@/components/ui/sonner";` and place `<Toaster />` inside `<main>` after `<RuntimeProvider>`:

```tsx
import { Toaster } from "@/components/ui/sonner";
// ...
function App() {
  return (
    <main className="h-screen w-screen">
      <RuntimeProvider>
        <ThreadWorkspace />
        {import.meta.env.DEV ? (
          <Suspense fallback={null}>
            <DevPanel />
          </Suspense>
        ) : null}
      </RuntimeProvider>
      <Toaster />
    </main>
  );
}
```

**Step 4: Verify build**

Run: `bun run build`
Expected: No errors.

**Step 5: Commit**

```bash
git add src/components/ui/sonner.tsx src/App.tsx package.json bun.lockb
git commit -m "feat: add sonner toast library for notifications"
```

---

### Task 2: Implement permission state management in claude-adapter.ts

This is the core backend: permission request map, subscriber pattern, auto-accept flag, and the three exported functions.

**Files:**
- Modify: `src/lib/claude-adapter.ts:245-325` (interface + stubbed functions)

**Step 1: Extend the ClaudePermissionRequest interface**

Replace the existing interface at line 245-251 with:

```typescript
export interface ClaudePermissionRequest {
  id: string;
  threadKey: string;
  toolName: string;
  toolArgs: string;           // JSON string of tool arguments
  prompt: string;             // Human-readable summary for the UI
  createdAt: number;
  resolved: boolean;
}
```

**Step 2: Add permission state variables**

Replace the `EMPTY_PERMISSION_REQUESTS` constant and the three stubbed functions (lines 306-325) with real implementations:

```typescript
// ── Permission state ────────────────────────────────────
let autoAcceptMode = false;
const permissionListeners = new Set<() => void>();

interface PendingPermission {
  request: ClaudePermissionRequest;
  resolve: () => void;
  reject: (reason: Error) => void;
}

const pendingPermissions = new Map<string, PendingPermission>();
let permissionSnapshot: ClaudePermissionRequest[] = [];
let permissionSnapshotVersion = -1;
let pendingPermissionsVersion = 0;

function notifyPermissionListeners(): void {
  pendingPermissionsVersion += 1;
  for (const listener of permissionListeners) {
    listener();
  }
}

function rebuildPermissionSnapshot(): ClaudePermissionRequest[] {
  if (permissionSnapshotVersion === pendingPermissionsVersion) {
    return permissionSnapshot;
  }
  permissionSnapshot = Array.from(pendingPermissions.values())
    .filter((p) => !p.request.resolved)
    .map((p) => p.request);
  permissionSnapshotVersion = pendingPermissionsVersion;
  return permissionSnapshot;
}

export function getClaudePermissionRequests(
  _threadKey: string | null,
): ClaudePermissionRequest[] {
  return rebuildPermissionSnapshot();
}

export function subscribeClaudePermissionRequests(
  listener: () => void,
): () => void {
  permissionListeners.add(listener);
  return () => {
    permissionListeners.delete(listener);
  };
}

export async function respondToClaudePermissionRequest(
  requestId: string,
  approved: boolean,
): Promise<void> {
  const pending = pendingPermissions.get(requestId);
  if (!pending) return;
  pending.request.resolved = true;
  if (approved) {
    pending.resolve();
  } else {
    pending.reject(new Error("Permission denied by user"));
  }
  pendingPermissions.delete(requestId);
  notifyPermissionListeners();
}

export function getAutoAcceptMode(): boolean {
  return autoAcceptMode;
}

export function setAutoAcceptMode(enabled: boolean): void {
  autoAcceptMode = enabled;
  // If enabling and there are pending permissions, auto-approve them all
  if (enabled) {
    for (const [id, pending] of pendingPermissions) {
      pending.request.resolved = true;
      pending.resolve();
      pendingPermissions.delete(id);
    }
    notifyPermissionListeners();
  }
}

export function toggleAutoAcceptMode(): boolean {
  const next = !autoAcceptMode;
  setAutoAcceptMode(next);
  return next;
}
```

**Step 3: Add the internal `requestToolPermission` function**

Add this function right after the permission state block (it will be called from the stream loop in Task 3):

```typescript
/**
 * Creates a permission request for a tool_use event and returns a promise
 * that resolves when the user approves or rejects with an error on deny.
 */
function requestToolPermission(
  threadKey: string,
  toolName: string,
  toolArgs: string,
): Promise<void> {
  if (autoAcceptMode) return Promise.resolve();

  const id = crypto.randomUUID();
  const prompt = formatToolPermissionPrompt(toolName, toolArgs);
  const request: ClaudePermissionRequest = {
    id,
    threadKey,
    toolName,
    toolArgs,
    prompt,
    createdAt: Date.now(),
    resolved: false,
  };

  return new Promise<void>((resolve, reject) => {
    pendingPermissions.set(id, { request, resolve, reject });
    notifyPermissionListeners();
  });
}

function formatToolPermissionPrompt(toolName: string, argsJson: string): string {
  try {
    const args = JSON.parse(argsJson);
    switch (toolName) {
      case "Bash":
        return `Run command: ${args.command ?? argsJson}`;
      case "Edit":
        return `Edit file: ${args.file_path ?? argsJson}`;
      case "Write":
        return `Write file: ${args.file_path ?? argsJson}`;
      case "Read":
        return `Read file: ${args.file_path ?? argsJson}`;
      case "Grep":
        return `Search for: ${args.pattern ?? argsJson}`;
      case "Glob":
        return `Find files: ${args.pattern ?? argsJson}`;
      case "WebSearch":
        return `Web search: ${args.query ?? argsJson}`;
      case "WebFetch":
        return `Fetch URL: ${args.url ?? argsJson}`;
      case "Task":
        return `Run subagent: ${args.description ?? argsJson}`;
      default:
        return `Use tool: ${toolName}`;
    }
  } catch {
    return `Use tool: ${toolName}`;
  }
}
```

**Step 4: Verify build**

Run: `bun run build`
Expected: No errors. The new functions are exported but not yet called from the stream loop.

**Step 5: Commit**

```bash
git add src/lib/claude-adapter.ts
git commit -m "feat: implement permission state management and request functions"
```

---

### Task 3: Wire permission checks into the stream processing loop

This is the most delicate change — inserting an `await` into the stream consumption loop to pause on tool_use events.

**Files:**
- Modify: `src/lib/claude-adapter.ts:1577-1645` (the `for await` loop over `spawnClaudeStreaming`)

**Step 1: Understand the insertion point**

The stream loop is at line 1577. Inside the `case "stdout"` handler (line 1614), each NDJSON line is processed by `processNdjsonLine()`. We need to intercept **after** a `content_block_start` with `type: "tool_use"` is parsed but **before** continuing to process more events.

The interception point is inside `processNdjsonLine` — after we detect a tool_use block start, we need to yield control back to the main loop and await permission. However, `processNdjsonLine` is a synchronous function, so we need to restructure slightly.

**Step 2: Add a permission gate to the stream loop**

The cleanest approach: after `processNdjsonLine(line)` returns, check if the event created a new tool accumulator that needs permission. Add a tracking variable.

In the `run()` generator function (inside `createClaudeAdapter`), add this state variable near the other per-attempt state (around line 1476):

```typescript
let pendingToolPermission: Promise<void> | null = null;
```

Then modify the `processNdjsonLine` function (around line 1481) to set this variable when it encounters a tool_use start. Add this block at the end of the `case "content_block_start"` section inside `processStreamEvent` (line 978-995):

Actually, the better approach is to check in the `case "stdout"` handler after `processNdjsonLine` returns. We can detect a new tool_use by checking if the last accumulator added to `streamState.orderedAccumulators` is a fresh tool_use.

**Revised approach — add permission check in the stdout handler:**

After line 1628 (`const shouldYield = processNdjsonLine(line);`), before the yield, check for new tool_use blocks:

```typescript
case "stdout": {
  // ... existing line buffer logic ...
  while (newlineIdx >= 0) {
    const rawLine = stdoutLineBuffer.slice(0, newlineIdx);
    stdoutLineBuffer = stdoutLineBuffer.slice(newlineIdx + 1);
    const line = rawLine.trim();
    if (line) {
      const shouldYield = processNdjsonLine(line);

      // ── Permission gate ──
      // Check if this line created a new tool_use accumulator
      const lastAcc = streamState.orderedAccumulators.at(-1);
      if (
        lastAcc &&
        lastAcc.blockType === "tool_use" &&
        lastAcc.toolName &&
        !lastAcc._permissionChecked
      ) {
        lastAcc._permissionChecked = true;
        // Yield current content first so the UI shows the tool card
        const preContent = buildContentFromAccumulators(streamState);
        if (preContent.length > 0) {
          yield { content: preContent } satisfies ChatModelRunResult;
        }
        // Await permission (resolves instantly if autoAcceptMode is on)
        await requestToolPermission(
          threadKey,
          lastAcc.toolName,
          lastAcc.argsJson,
        );
      }
      // ── End permission gate ──

      if (shouldYield) {
        const content = buildContentFromAccumulators(streamState);
        if (content.length > 0) {
          yield { content } satisfies ChatModelRunResult;
        }
      }
    }
    newlineIdx = stdoutLineBuffer.indexOf("\n");
  }
  break;
}
```

**Step 3: Add `_permissionChecked` to the accumulator type**

Find the accumulator type/interface (it's an internal type in claude-adapter.ts). Add `_permissionChecked?: boolean` to it. Search for where the accumulator shape is defined (likely a type alias or interface near the `makeAccumulator` function).

Look for the accumulator creation and add the field:

```typescript
// In the accumulator type/shape, add:
_permissionChecked?: boolean;
```

**Step 4: Handle denial (rejected promise) in the stream loop**

The `await requestToolPermission(...)` will throw if the user denies. This unhandled rejection will propagate up through the `for await` loop. We need to catch it and handle gracefully.

Wrap the `for await` loop body in a try/catch for permission denials. When caught:

```typescript
for await (const item of spawnClaudeStreaming(spawnConfig, threadKey, abortSignal)) {
  if (abortSignal.aborted) {
    wasAborted = true;
    break;
  }

  try {
    switch (item.kind) {
      // ... existing cases with permission gate in stdout ...
    }
  } catch (err) {
    if (err instanceof Error && err.message === "Permission denied by user") {
      // Kill the child process
      const child = activeChildByThread.get(threadKey);
      if (child) {
        void child.kill();
      }
      // Yield a status message
      const content = buildContentFromAccumulators(streamState);
      content.push({ type: "text", text: "\n\n*Tool permission denied. Session paused.*" });
      yield {
        content,
        status: { type: "incomplete", reason: "cancelled" },
      } satisfies ChatModelRunResult;
      // Break out of stream loop — session will resume on next user message
      break;
    }
    throw err; // Re-throw unexpected errors
  }
}
```

**Step 5: Verify build**

Run: `bun run build`
Expected: No errors.

**Step 6: Commit**

```bash
git add src/lib/claude-adapter.ts
git commit -m "feat: wire permission gate into stream processing loop"
```

---

### Task 4: Enhance the PermissionApprovalBar UI

The existing component shows a generic `prompt` string. We need to show tool name, argument preview, an "Accept All" button, and keyboard shortcuts.

**Files:**
- Modify: `src/components/assistant-ui/thread.tsx:420-460`

**Step 1: Enhance the component**

Replace the `PermissionApprovalBar` component (lines 420-460) with:

```tsx
const PermissionApprovalBar: FC = () => {
  const activeThreadId = useAuiState(({ threadListItem }) => threadListItem.remoteId ?? null);
  const getSnapshot = useCallback(
    () => getClaudePermissionRequests(activeThreadId),
    [activeThreadId],
  );
  const requests = useSyncExternalStore(
    subscribeClaudePermissionRequests,
    getSnapshot,
  );

  const current = requests[0];

  // Keyboard shortcuts: Enter = approve, Escape = deny
  useEffect(() => {
    if (!current) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        void respondToClaudePermissionRequest(current.id, true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        void respondToClaudePermissionRequest(current.id, false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [current]);

  if (!current) return null;

  return (
    <div className="aui-permission-approval-bar flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm shadow-sm">
      <div className="flex items-center gap-2">
        <span className="font-medium text-amber-400">{current.toolName}</span>
        <span className="text-muted-foreground">wants to execute</span>
      </div>
      <p className="line-clamp-2 font-mono text-xs text-foreground/80">{current.prompt}</p>
      <div className="flex items-center gap-2 pt-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void respondToClaudePermissionRequest(current.id, false);
          }}
        >
          Deny <kbd className="ml-1 text-[10px] text-muted-foreground">Esc</kbd>
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => {
            void respondToClaudePermissionRequest(current.id, true);
          }}
        >
          Approve <kbd className="ml-1 text-[10px] text-muted-foreground/70">Enter</kbd>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="ml-auto text-muted-foreground"
          onClick={() => {
            toggleAutoAcceptMode();
          }}
        >
          Accept All <kbd className="ml-1 text-[10px]">⇧⇥</kbd>
        </Button>
      </div>
    </div>
  );
};
```

**Step 2: Add the missing import**

At the top of `thread.tsx`, add `toggleAutoAcceptMode` to the import from `claude-adapter`:

```typescript
import {
  getClaudePermissionRequests,
  respondToClaudePermissionRequest,
  subscribeClaudePermissionRequests,
  toggleAutoAcceptMode,
} from "@/lib/claude-adapter";
```

Also add `useEffect` to the React imports if not already imported.

**Step 3: Verify build**

Run: `bun run build`
Expected: No errors.

**Step 4: Commit**

```bash
git add src/components/assistant-ui/thread.tsx
git commit -m "feat: enhance PermissionApprovalBar with tool info and keyboard shortcuts"
```

---

### Task 5: Add Shift+Tab global toggle hook

Create the `usePermissionMode` hook that listens for Shift+Tab globally and toggles auto-accept mode with toast feedback.

**Files:**
- Create: `src/hooks/use-permission-mode.ts`
- Modify: `src/components/ThreadWorkspace.tsx`

**Step 1: Create the hook**

Create `src/hooks/use-permission-mode.ts`:

```typescript
import { useEffect } from "react";
import { toast } from "sonner";
import { toggleAutoAcceptMode, getAutoAcceptMode } from "@/lib/claude-adapter";

export function usePermissionMode(): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Tab" && e.shiftKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        const nowEnabled = toggleAutoAcceptMode();
        if (nowEnabled) {
          toast.success("Auto-accept enabled", {
            description: "All tools will be approved automatically. Press Shift+Tab to disable.",
            duration: 3000,
          });
        } else {
          toast.info("Auto-accept disabled", {
            description: "Tools will require approval before executing.",
            duration: 3000,
          });
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
}
```

**Step 2: Mount the hook in ThreadWorkspace**

In `src/components/ThreadWorkspace.tsx`, import and call the hook:

```typescript
import { usePermissionMode } from "@/hooks/use-permission-mode";

export function ThreadWorkspace() {
  usePermissionMode();
  const [isNavOpen, setIsNavOpen] = useState(true);
  // ... rest unchanged
```

**Step 3: Verify build**

Run: `bun run build`
Expected: No errors.

**Step 4: Commit**

```bash
git add src/hooks/use-permission-mode.ts src/components/ThreadWorkspace.tsx
git commit -m "feat: add Shift+Tab global toggle for auto-accept permission mode"
```

---

### Task 6: Add auto-accept mode visual indicator

When auto-accept is enabled, show a persistent indicator so the user knows tools are being auto-approved.

**Files:**
- Modify: `src/components/assistant-ui/thread.tsx`

**Step 1: Add an AutoAcceptIndicator component**

Add a new component near the `PermissionApprovalBar` in `thread.tsx`:

```tsx
const AutoAcceptIndicator: FC = () => {
  const [enabled, setEnabled] = useState(getAutoAcceptMode());

  useEffect(() => {
    // Poll auto-accept state (lightweight, no external store needed for a boolean)
    const interval = setInterval(() => {
      setEnabled(getAutoAcceptMode());
    }, 500);
    return () => clearInterval(interval);
  }, []);

  if (!enabled) return null;

  return (
    <div className="flex items-center justify-center gap-2 rounded-md border border-green-500/30 bg-green-500/5 px-3 py-1.5 text-xs text-green-400">
      <span>Auto-accepting all tools</span>
      <kbd className="rounded bg-muted px-1 text-[10px] text-muted-foreground">⇧⇥ to disable</kbd>
    </div>
  );
};
```

**Step 2: Place it in the viewport footer**

In the `Thread` component's viewport footer (around line 147-148), add `<AutoAcceptIndicator />` right after `<PermissionApprovalBar />`:

```tsx
<ThreadPrimitive.ViewportFooter className="...">
  <ThreadScrollToBottom />
  <PermissionApprovalBar />
  <AutoAcceptIndicator />
  {needsWorkspace ? (
    // ...
```

**Step 3: Add `getAutoAcceptMode` to the import**

Update the import from `claude-adapter` to include `getAutoAcceptMode`:

```typescript
import {
  getClaudePermissionRequests,
  respondToClaudePermissionRequest,
  subscribeClaudePermissionRequests,
  toggleAutoAcceptMode,
  getAutoAcceptMode,
} from "@/lib/claude-adapter";
```

Also add `useState` to React imports if not already there.

**Step 4: Verify build**

Run: `bun run build`
Expected: No errors.

**Step 5: Commit**

```bash
git add src/components/assistant-ui/thread.tsx
git commit -m "feat: add auto-accept mode visual indicator in thread footer"
```

---

### Task 7: Manual integration test

Verify the full flow works end-to-end in the Tauri dev window.

**Files:** None (testing only)

**Step 1: Start dev server**

Run: `cargo tauri dev`

**Step 2: Test permission flow**

1. Open a thread and send a message that will trigger tool use (e.g., "Read the contents of package.json")
2. Verify the `PermissionApprovalBar` appears with "Read" tool name and file path
3. Click "Approve" — verify streaming continues and tool result renders
4. Send another message triggering a tool — click "Deny" — verify the stream stops with "Tool permission denied" message
5. Send a follow-up message — verify the session resumes via `--resume`

**Step 3: Test Shift+Tab toggle**

1. Press Shift+Tab — verify toast says "Auto-accept enabled"
2. Send a message with tool use — verify no permission dialog appears, tools auto-execute
3. Press Shift+Tab again — verify toast says "Auto-accept disabled"
4. Send another message — verify permission dialog appears again

**Step 4: Test "Accept All" button**

1. With auto-accept OFF, trigger a tool use
2. When permission dialog appears, click "Accept All"
3. Verify the current tool is approved AND auto-accept mode turns on (green indicator visible)

**Step 5: Test keyboard shortcuts**

1. Trigger a tool use, press Enter — verify approved
2. Trigger another, press Escape — verify denied

**Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix: address issues found during integration testing"
```
