# Concurrency Patterns

## The Queue+Resolver Bridge (Callbacks → Async Generator)

Tauri's shell plugin uses **callback-based** event delivery (`command.stdout.on("data", cb)`). The adapter needs **async generator** semantics (`for await...of`). The bridge pattern:

```typescript
const queue: StreamQueueItem[] = [];
let resolve: (() => void) | null = null;
let done = false;

function enqueue(item) {
  queue.push(item);
  if (resolve) { const r = resolve; resolve = null; r(); }
}

// In the generator:
while (!done) {
  if (queue.length === 0) {
    await new Promise<void>(r => { resolve = r; });
  }
  while (queue.length > 0) yield queue.shift()!;
}
```

**How it works:** The generator blocks on a Promise when the queue is empty. Callbacks call `enqueue()`, which pushes the item and resolves the blocking Promise. The generator wakes up and yields all queued items.

**Why not ReadableStream?** Tauri's plugin doesn't provide a ReadableStream interface for subprocess stdout. The callback→generator bridge is the lightest abstraction.

## Yield Throttling (~60fps)

The adapter doesn't yield to assistant-ui on every content delta. Instead:
```
if (Date.now() - lastYieldTime >= 16ms) {
  yield { content: buildContentFromAccumulators(state) };
  lastYieldTime = Date.now();
}
```

This prevents excessive DOM reconciliation during fast streaming. A `pendingYield` flag ensures the final state is always yielded even if the last event falls within the throttle window.

## Concurrent Title Generation

When a new thread's first message is sent, the adapter fires off `prefetchTitle()` **before** the main Claude CLI call completes. This spawns a second Claude CLI instance (Haiku model, fast) that runs concurrently:

```
Main stream:  [spawn claude opus] ─────streaming──────────────────▶ done
Title stream: [spawn claude haiku] ──▶ "Fix Auth Bug" ──▶ onTitleReady()
```

The `titleReadyCallbacks` Map notifies the thread list adapter when the title is available, which then calls `rename()` to update the thread title mid-conversation.

## Session Hydration (Lazy, Once)

Session state is loaded from SQLite on first access per thread:
```
hydrateSessionCache(threadKey) {
  if (hydratedSessions.has(threadKey)) return;
  const row = await db.sessions.get(threadKey);
  if (row?.session_id) sessionByThread.set(threadKey, row.session_id);
  hydratedSessions.add(threadKey);
}
```

This avoids loading all sessions on startup. The `hydratedSessions` Set ensures the SQLite read happens exactly once per thread per app lifecycle.

## AbortSignal Integration

The adapter's `run()` method accepts an `AbortSignal` from assistant-ui. On abort:
1. The active child process is killed (`child.kill()`)
2. The streaming generator's close handler fires
3. The `wasAborted` flag prevents retry logic from kicking in
4. The thread lock is released in the `finally` block

**Important:** Killing the child process is **async** — the process may emit a few more stdout events before actually dying. The generator must handle events arriving after abort.
