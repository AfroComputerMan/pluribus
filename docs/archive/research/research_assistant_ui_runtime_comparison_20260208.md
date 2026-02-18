# assistant-ui Runtime Comparison: ExternalStoreRuntime vs LocalRuntime

## Research Report -- February 8, 2026

---

## Executive Summary

For a Tauri app where **Claude Code CLI already manages its own conversation state**, the choice between `ExternalStoreRuntime` and `LocalRuntime` has major architectural implications. After analyzing the source code, documentation, and internal mechanics of both runtimes, here are the key findings:

| Aspect | LocalRuntime | ExternalStoreRuntime |
|--------|-------------|---------------------|
| **State ownership** | assistant-ui owns all state | You own all state |
| **Branching** | Built-in, automatic | Only if you provide `setMessages` |
| **Editing** | Built-in, automatic | Only if you provide `onEdit` |
| **What happens on edit** | Truncates messages, calls adapter's `run()` with truncated history | Calls your `onEdit` callback -- you decide |
| **Best for backend-managed state** | Hybrid approach possible | Direct fit, but you wire everything |

**Recommendation for your use case**: Use `LocalRuntime` as the primary runtime. It handles branching/editing automatically in-memory while you map each "branch" to a different Claude Code CLI session. This is the hybrid approach detailed in Section 6.

---

## 1. ExternalStoreRuntime in Detail

### How `useExternalStoreRuntime` Works

`ExternalStoreRuntime` acts as a bridge between your external state management and assistant-ui's component system. You provide an `ExternalStoreAdapter<T>` object, and assistant-ui reads from it reactively.

**Minimal usage:**

```tsx
import {
  useExternalStoreRuntime,
  ThreadMessageLike,
  AppendMessage,
  AssistantRuntimeProvider,
} from "@assistant-ui/react";

const runtime = useExternalStoreRuntime({
  messages,        // readonly T[] -- your message array
  convertMessage,  // (message: T, index: number) => ThreadMessageLike
  onNew,           // (message: AppendMessage) => Promise<void>
  isRunning,       // boolean -- shows typing indicator when true
});
```

### Full ExternalStoreAdapter API

From the source code at `packages/react/src/legacy-runtime/runtime-cores/external-store/ExternalStoreThreadRuntimeCore.tsx`, capabilities are dynamically determined by which handlers you provide:

| Field | Type | Required | Enables |
|-------|------|----------|---------|
| `messages` | `readonly T[]` | **Yes** | Core functionality |
| `onNew` | `(message: AppendMessage) => Promise<void>` | **Yes** | Sending messages |
| `convertMessage` | `(message: T, index: number) => ThreadMessageLike` | No (if T is ThreadMessageLike) | Custom message formats |
| `isRunning` | `boolean` | No (default: false) | Typing indicator + optimistic assistant message |
| `isDisabled` | `boolean` | No | Disables input |
| `setMessages` | `(messages: T[]) => void` | No | **Branch switching** |
| `onEdit` | `(message: AppendMessage) => Promise<void>` | No | **Message editing** |
| `onReload` | `(parentId: string \| null, config: StartRunConfig) => Promise<void>` | No | **Regeneration button** |
| `onCancel` | `() => Promise<void>` | No | **Cancel button** |
| `onAddToolResult` | `(options: AddToolResultOptions) => Promise<void> \| void` | No | Tool result handling |
| `suggestions` | `readonly ThreadSuggestion[]` | No | Suggested prompts |
| `extras` | `unknown` | No | Arbitrary data via `runtime.extras` |
| `joinStrategy` | `"concat-content" \| "none"` | No (default: "concat-content") | How adjacent assistant messages merge |
| `adapters.threadList` | `ExternalStoreThreadListAdapter` | No | Multi-thread sidebar |
| `adapters.attachments` | `AttachmentAdapter` | No | File uploads |
| `adapters.speech` | `SpeechSynthesisAdapter` | No | Text-to-speech |
| `adapters.feedback` | `FeedbackAdapter` | No | Thumbs up/down |
| `unstable_capabilities.copy` | `boolean` | No (default: true) | Copy button |

The capability detection logic from source:

```typescript
// From ExternalStoreThreadRuntimeCore.tsx
this._capabilities = {
  switchToBranch: this._store.setMessages !== undefined,
  switchBranchDuringRun: false,  // External store NEVER supports branch switching during run
  edit: this._store.onEdit !== undefined,
  reload: this._store.onReload !== undefined,
  cancel: this._store.onCancel !== undefined,
  // ...
};
```

### How Branching Works with ExternalStoreRuntime

Even with `ExternalStoreRuntime`, assistant-ui internally maintains a `MessageRepository` (a tree data structure) for branch tracking. When you provide `setMessages`, here is what happens:

1. Your `messages` array is imported into the internal `MessageRepository` tree
2. When the user clicks a branch picker button, `switchToBranch(branchId)` is called
3. The runtime walks the tree to find the new active branch path
4. It calls **your** `setMessages()` callback with the new linear message array for that branch
5. Your state updates, the new `messages` array flows back in, and the UI re-renders

From the source (`ExternalStoreThreadRuntimeCore.tsx`):

```typescript
public override switchToBranch(branchId: string): void {
  if (!this._store.setMessages)
    throw new Error("Runtime does not support switching branches.");

  // Silently ignore branch switches while running
  if (this._store.isRunning) {
    return;
  }

  this.repository.switchToBranch(branchId);
  this.updateMessages(this.repository.getMessages());
}
```

**Critical insight**: Branch switching during a run is explicitly disabled for ExternalStoreRuntime (`switchBranchDuringRun: false`). This is because the runtime cannot safely interrupt your external state management.

### How Editing Works with ExternalStoreRuntime

When a user edits message #3 in a 5-message conversation:

1. The `DefaultEditComposerRuntimeCore` captures the edit
2. It calls `runtime.append()` with `parentId` set to the parent of the edited message
3. `ExternalStoreThreadRuntimeCore.append()` checks: is `parentId` different from the last message's ID?
4. If yes (it's an edit, not a new message), it calls `this._store.onEdit(message)`
5. **You** decide what to do in `onEdit` -- truncate messages, call your backend, etc.

From the source:

```typescript
public async append(message: AppendMessage): Promise<void> {
  if (message.parentId !== (this.messages.at(-1)?.id ?? null)) {
    if (!this._store.onEdit)
      throw new Error("Runtime does not support editing messages.");
    await this._store.onEdit(message);
  } else {
    await this._store.onNew(message);
  }
}
```

---

## 2. LocalRuntime Branching Mechanics

### The ChatModelAdapter Interface

`LocalRuntime` requires a single adapter with one method:

```typescript
interface ChatModelAdapter {
  run(options: ChatModelRunOptions): ChatModelRunResult | AsyncGenerator<ChatModelRunResult>;
}

interface ChatModelRunOptions {
  messages: readonly ThreadMessage[];  // The conversation history
  abortSignal: AbortSignal;            // For cancellation
  context: ModelContext;               // Tools, config, etc.
  unstable_threadId?: string;          // Current thread ID
}
```

### What Happens When a User Edits Message #3 in a 5-Message Conversation

This is the key question. Here is the exact internal flow, traced through the source code:

**Step 1: Edit composer captures the edit**

When the user clicks "Edit" on message #3, `DefaultEditComposerRuntimeCore` is created. It stores the `parentId` (message #2's ID) and the `sourceId` (message #3's ID).

**Step 2: User submits the edited text**

`DefaultEditComposerRuntimeCore.handleSend()` calls:
```typescript
this.runtime.append({
  ...message,
  parentId: this._parentId,   // message #2's ID
  sourceId: this._sourceId,   // message #3's ID (the one being edited)
});
```

**Step 3: LocalThreadRuntimeCore.append() processes it**

```typescript
public async append(message: AppendMessage): Promise<void> {
  const newMessage = fromThreadMessageLike(message, generateId(), { type: "complete", reason: "unknown" });
  this.repository.addOrUpdateMessage(message.parentId, newMessage);
  // ...
  if (startRun) {
    await this.startRun({ parentId: newMessage.id, ... });
  }
}
```

The new edited message is added as a **new child** of message #2 in the tree. Messages #3, #4, #5 still exist in the tree (they are on a different branch) but are no longer in the active path.

**Step 4: `startRun()` calls the adapter**

```typescript
public async startRun({ parentId, runConfig }: StartRunConfig): Promise<void> {
  // ...
  message = await this.performRoundtrip(parentId, message, runConfig);
}
```

Inside `performRoundtrip()`:
```typescript
const messages = parentId ? this.repository.getMessages(parentId) : [];
```

This gets the message history **up to and including the new edited message** (messages #1, #2, and the new edited #3). It does NOT include old #4 and #5.

**Step 5: The adapter's `run()` is called with truncated history**

```typescript
const promiseOrGenerator = runCallback({
  messages,           // [msg1, msg2, newEditedMsg3] -- truncated!
  abortSignal,
  context,
  unstable_threadId: threadId,
});
```

**The answer**: Yes, LocalRuntime effectively "truncates" the conversation at the edit point and calls your adapter's `run()` with only the messages up to the edited one. The old messages (#4, #5) remain on the old branch and can be navigated back to via the branch picker.

### The MessageRepository Tree Structure

The `MessageRepository` class (at `packages/react/src/legacy-runtime/runtime-cores/utils/MessageRepository.tsx`) is a tree, not a list:

```
Root
  +-- Message #1 (user)
       +-- Message #2 (assistant)
            +-- Message #3 (user, original)       <-- old branch
            |    +-- Message #4 (assistant)
            |         +-- Message #5 (user)
            +-- Message #3b (user, edited)         <-- new branch (active)
                 +-- Message #4b (assistant, new response)
```

Each node has:
- `prev`: parent reference
- `children`: array of child message IDs
- `next`: the currently active child (for branch navigation)
- `level`: depth in the tree

The `head` pointer tracks the current leaf of the active branch. Branch switching simply changes the `next` pointers along the path.

---

## 3. ThreadMessageLike Format

### Full Type Definition (from source)

```typescript
type ThreadMessageLike = {
  readonly role: "assistant" | "user" | "system";       // REQUIRED
  readonly content:                                      // REQUIRED
    | string
    | readonly (
        | TextMessagePart           // { type: "text", text: string }
        | ReasoningMessagePart      // { type: "reasoning", text: string }
        | SourceMessagePart         // { type: "source", ... }
        | ImageMessagePart          // { type: "image", image: string }
        | FileMessagePart           // { type: "file", ... }
        | DataMessagePart           // { type: "data", data: unknown }
        | Unstable_AudioMessagePart // { type: "audio", ... }
        | {                         // Tool calls
            readonly type: "tool-call";
            readonly toolCallId?: string;
            readonly toolName: string;
            readonly args?: ReadonlyJSONObject;
            readonly argsText?: string;
            readonly artifact?: any;
            readonly result?: any;
            readonly isError?: boolean;
          }
      )[];
  readonly id?: string;                                  // Optional - auto-generated if missing
  readonly createdAt?: Date;                             // Optional - defaults to new Date()
  readonly status?: MessageStatus;                       // Optional (assistant only)
  readonly attachments?: readonly CompleteAttachment[];   // Optional (user only)
  readonly metadata?: {                                  // Optional
    readonly steps?: readonly ThreadStep[];              // Tool call steps (assistant only)
    readonly custom?: Record<string, unknown>;           // YOUR CUSTOM DATA
    readonly unstable_state?: ReadonlyJSONValue;
    readonly unstable_annotations?: readonly ReadonlyJSONValue[];
    readonly unstable_data?: readonly ReadonlyJSONValue[];
    readonly submittedFeedback?: { readonly type: "positive" | "negative" };
  };
};
```

### Can Messages Have Metadata Like `session_id`?

**Yes.** Use the `metadata.custom` field:

```typescript
const message: ThreadMessageLike = {
  role: "assistant",
  content: [{ type: "text", text: "Hello!" }],
  id: "msg-123",
  metadata: {
    custom: {
      session_id: "claude-code-session-abc123",
      model: "claude-opus-4-6",
      cost_usd: 0.015,
      // any other arbitrary data
    },
  },
};
```

The `metadata.custom` field is typed as `Record<string, unknown>`, so you can put anything there. It flows through the system and is accessible via `useMessage()` and other hooks.

---

## 4. ExternalStoreRuntime with isRunning + onNew: Does Branching Work?

### Short Answer: Only If You Provide `setMessages`

With just `isRunning` and `onNew`, you get:
- Basic chat (send/receive)
- Typing indicator
- Optimistic assistant message during generation

You do **NOT** get:
- Branch switching (requires `setMessages`)
- Message editing (requires `onEdit`)
- Regeneration (requires `onReload`)
- Cancellation (requires `onCancel`)

The internal `MessageRepository` tree still tracks branches, but the UI will not render the branch picker or edit buttons because the capabilities are set to `false`.

### What It Takes to Enable Branching with ExternalStoreRuntime

You must provide `setMessages` AND `onEdit`:

```typescript
const runtime = useExternalStoreRuntime({
  messages,
  isRunning,
  onNew,
  setMessages: (newMessages) => {
    // Called when user switches branches
    // newMessages is the new linear message array for the selected branch
    setMyMessages(newMessages);
  },
  onEdit: async (message) => {
    // Called when user edits a message
    // message.parentId tells you where the edit happened
    // You must truncate your messages and regenerate
    const truncated = messages.slice(0, findIndex(message.parentId) + 1);
    const userMsg = { role: "user", content: message.content };
    setMyMessages([...truncated, userMsg]);

    setIsRunning(true);
    const response = await myBackend.chat([...truncated, userMsg]);
    setMyMessages([...truncated, userMsg, response]);
    setIsRunning(false);
  },
});
```

**The branch history is maintained internally** by the MessageRepository, but you must provide the mechanism to actually switch what's displayed. If you omit `setMessages`, branch switching is not just hidden -- it is disabled entirely.

---

## 5. Can You Disable Branching?

### Yes, Multiple Ways

**Option A: Simply don't include `BranchPickerPrimitive` in your message component.**

If you build a custom `Thread` component, just omit the branch picker entirely:

```tsx
const MyMessage = () => (
  <MessagePrimitive.Root>
    <MessagePrimitive.Content />
    {/* No BranchPickerPrimitive here -- no branch UI */}
  </MessagePrimitive.Root>
);
```

**Option B: Use `hideWhenSingleBranch` (recommended)**

This shows the branch picker only when there are actually multiple branches:

```tsx
<BranchPickerPrimitive.Root hideWhenSingleBranch>
  <BranchPickerPrimitive.Previous />
  <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
  <BranchPickerPrimitive.Next />
</BranchPickerPrimitive.Root>
```

**Option C: Conditionally render based on branch count**

```tsx
const hasBranches = useMessageIf({ hasBranches: true }); // true when branchCount >= 2
```

**Option D: With ExternalStoreRuntime, don't provide `setMessages`**

If you don't provide `setMessages`, the runtime's `switchToBranch` capability is `false`, and any branch picker UI will be disabled (buttons won't work).

**Note**: Even without the branch picker UI, LocalRuntime still creates branches internally when messages are edited. The branches are just not navigable.

---

## 6. Hybrid Approach: LocalRuntime for UI + Different Backend Sessions per Branch

### This Is the Recommended Architecture for Your Use Case

The hybrid approach works like this:

1. Use `LocalRuntime` with a `ChatModelAdapter` that manages the UI state (branching, editing, etc.)
2. Each time the adapter's `run()` is called, it routes to a Claude Code CLI session
3. Different branches can map to different CLI sessions (or the same session re-invoked)

### Implementation Pattern

```typescript
const ClaudeCodeAdapter: ChatModelAdapter = {
  async *run({ messages, abortSignal, unstable_threadId }) {
    // 'messages' is the full conversation for the current branch
    // This is already truncated/branched by LocalRuntime's MessageRepository

    // Option 1: Always create a new CLI session per run
    const session = await claudeCodeCli.createSession();

    // Option 2: Reuse session based on thread ID
    // const session = sessionMap.get(unstable_threadId) ?? await createSession();

    // Option 3: Map branches to different sessions
    // Use message IDs or the message array signature as a branch key

    // Send the conversation to Claude Code CLI
    const stream = await session.send({
      messages: messages.map(m => ({
        role: m.role,
        content: m.content.filter(c => c.type === "text").map(c => c.text).join("\n"),
      })),
      signal: abortSignal,
    });

    // Stream responses back
    let text = "";
    for await (const chunk of stream) {
      text += chunk;
      yield {
        content: [{ type: "text", text }],
      };
    }
  },
};

const runtime = useLocalRuntime(ClaudeCodeAdapter, {
  maxSteps: 5,  // For tool call loops
});
```

### Why This Works Well

1. **Branching is free**: LocalRuntime's `MessageRepository` handles all branch tracking in-memory. When the user edits message #3, LocalRuntime automatically:
   - Preserves the old branch (messages #3-#5)
   - Creates a new branch starting from the edit
   - Calls `run()` with only messages #1, #2, edited-#3

2. **Backend simplicity**: Your adapter's `run()` always receives a clean, linear message array. It doesn't need to know about branches -- it just processes what it gets.

3. **Session mapping**: Since `run()` receives `unstable_threadId`, you can maintain a `Map<string, ClaudeCodeSession>` to reuse sessions. For branches, you might create a new session (since Claude Code CLI would need to start from the truncated conversation anyway).

4. **No state sync issues**: You don't need to sync state between assistant-ui and an external store. LocalRuntime IS the state.

### The Trade-off

The trade-off is that **LocalRuntime's in-memory state is the source of truth**. If the Claude Code CLI has side effects (file changes, etc.) that happen on branch A, and the user switches to branch B, the file changes from branch A still exist on disk. This is inherent to any branching system that talks to a stateful backend.

For persistence across page reloads, use the `ThreadHistoryAdapter`:

```typescript
const runtime = useLocalRuntime(ClaudeCodeAdapter, {
  adapters: {
    history: {
      async load() {
        const saved = localStorage.getItem("chat-history");
        return saved ? JSON.parse(saved) : { messages: [] };
      },
      async append({ parentId, message }) {
        // Save incrementally
      },
    },
  },
});
```

---

## 7. Summary Decision Matrix

| If your situation is... | Use... | Why |
|------------------------|--------|-----|
| Backend manages all state, you want full control | `ExternalStoreRuntime` | You wire everything, total flexibility |
| Backend is stateless per-request, you want easy branching | `LocalRuntime` | Built-in state management + branching |
| Backend has its own sessions (Claude Code CLI) | `LocalRuntime` (hybrid) | Let assistant-ui handle branching UI, map branches to sessions |
| You use Redux/Zustand already | `ExternalStoreRuntime` | Integrates with your existing state |
| You want to disable branching entirely | Either (omit branch picker) | UI-level control via component composition |
| You need branch switching during generation | `LocalRuntime` only | ExternalStoreRuntime explicitly disables this |

---

## Sources

- [ExternalStoreRuntime Documentation](https://www.assistant-ui.com/docs/runtimes/custom/external-store)
- [LocalRuntime Documentation](https://www.assistant-ui.com/docs/runtimes/custom/local)
- [Picking a Runtime Guide](https://www.assistant-ui.com/docs/runtimes/pick-a-runtime)
- [Message Branching Guide](https://www.assistant-ui.com/docs/guides/Branching)
- [Message Editing Guide](https://www.assistant-ui.com/docs/advanced/Editing)
- [BranchPickerPrimitive API](https://www.assistant-ui.com/docs/api-reference/primitives/branch-picker)
- Source: `MessageRepository.tsx` -- tree data structure for branch management
- Source: `LocalThreadRuntimeCore.tsx` -- handles `append()` and `startRun()` for LocalRuntime
- Source: `ExternalStoreThreadRuntimeCore.tsx` -- capability detection and branch switching
- Source: `DefaultEditComposerRuntimeCore.tsx` -- edit submission flow
- Source: `ThreadMessageLike.tsx` -- full type definition including metadata.custom
- Source: `BaseThreadRuntimeCore.tsx` -- shared editing and branch switching logic
