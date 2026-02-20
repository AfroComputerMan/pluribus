# Agent SDK Sidecar Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Bun sidecar backed by `@anthropic-ai/claude-agent-sdk` as a parallel `ChatModelAdapter`, switchable globally via Settings, with the existing shell adapter staying intact.

**Architecture:** A compiled Bun binary (`sidecar/agent-sdk-bridge/index.ts`) reads NDJSON queries from stdin and writes NDJSON `SDKMessage` events to stdout. The frontend `agent-sdk-adapter.ts` spawns this sidecar once via `Command.sidecar()`, routes queries to it over stdin, and maps its output into assistant-ui content parts — implementing the same `ChatModelAdapter` contract as `claude-adapter.ts`. A global `adapter_type` setting in SQLite controls which adapter `RuntimeProvider` instantiates.

**Tech Stack:** Bun (sidecar compile + runtime), `@anthropic-ai/claude-agent-sdk` (sidecar only), `@tauri-apps/plugin-shell` `Command.sidecar()`, SQLite `global_settings` table, existing assistant-ui / shadcn/Radix UI.

**Design doc:** `docs/plans/2026-02-20-agent-sdk-sidecar-design.md`

---

## Before You Start

- **No test framework exists** in this project. Verification = TypeScript build passing + manual smoke test in the running app.
- Build commands: `bun run build` (type-check + Vite bundle), `cargo tauri dev` (full app).
- All file paths are relative to the project root `/home/user/projects/pluribus/`.
- The existing `claude-adapter.ts` is **not modified** except for adding two small exports (Task 1).
- Read `docs/plans/2026-02-20-agent-sdk-sidecar-design.md` for the full design rationale before proceeding.

---

## Task 1: Add two exports to `claude-adapter.ts`

`agent-sdk-adapter.ts` needs to reuse prompt extraction and push events into the shared DevPanel buffer. Add both exports to the existing file without changing any existing behavior.

**Files:**
- Modify: `src/lib/claude-adapter.ts`

**Step 1: Make `extractUserPrompt` exported**

Find line 637 in `src/lib/claude-adapter.ts`:
```typescript
function extractUserPrompt(
```
Change it to:
```typescript
export function extractUserPrompt(
```

**Step 2: Add `pushClaudeDevEvent` export just after `clearClaudeDevSnapshot` (after line ~566)**

Add this function immediately after the `clearClaudeDevSnapshot` function body:

```typescript
/**
 * Push a dev event into the shared circular buffer and notify listeners.
 * Called by agent-sdk-adapter.ts so SDK-mode events appear in DevPanel.
 */
export function pushClaudeDevEvent(event: ClaudeDevEvent): void {
  pushDevEventToBuffer(event);
  if (event.parsed.type === "system" && event.parsed.subtype === "init") {
    devSnapshot = { ...devSnapshot, latestInitEvent: event, latestSessionId: event.parsed.session_id ?? null };
    devSnapshotVersion += 1;
  }
  if (event.parsed.type === "result") {
    devSnapshot = { ...devSnapshot, latestUsageEvent: event };
    devSnapshotVersion += 1;
  }
  devEventsVersion += 1;
  notifyDevListeners();
}
```

**Step 3: Add `sdkMessage` to `ClaudeDevEvent`**

Find the `ClaudeDevEvent` interface (around line 210):
```typescript
export interface ClaudeDevEvent {
  id: string;
  at: number;
  threadKey: string;
  raw: string;
  parsed: ClaudeStreamEvent;
  category: ClaudeDevEventCategory;
}
```
Change it to:
```typescript
export interface ClaudeDevEvent {
  id: string;
  at: number;
  threadKey: string;
  raw: string;
  parsed: ClaudeStreamEvent;
  category: ClaudeDevEventCategory;
  /** Present only when emitted by agent-sdk-adapter. The raw SDKMessage object. */
  sdkMessage?: SidecarSdkMessage;
}
```

> `SidecarSdkMessage` will be imported from `agent-sdk-adapter.ts` — but that creates a circular dependency. Instead, define a minimal shared type. Add this **before** the `ClaudeDevEvent` interface:

```typescript
/** Minimal shape of an SDKMessage forwarded from the Agent SDK sidecar. */
export interface SidecarSdkMessage {
  type: "assistant" | "user" | "result" | "system" | "stream_event";
  subtype?: string;
  session_id?: string;
  message?: {
    content: Array<{
      type: string;
      text?: string;
      id?: string;
      name?: string;
      input?: unknown;
      thinking?: string;
    }>;
  };
  result?: string;
  total_cost_usd?: number;
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    cache_creation_input_tokens?: number | null;
    cache_read_input_tokens?: number | null;
  };
  tools?: string[];
  model?: string;
  cwd?: string;
}
```

**Step 4: Verify TypeScript compiles**

```bash
bun run build
```
Expected: no TypeScript errors. (Vite bundle may warn about unused imports — that's fine.)

**Step 5: Commit**

```bash
git add src/lib/claude-adapter.ts
git commit -m "feat(adapter): export extractUserPrompt, pushClaudeDevEvent, SidecarSdkMessage for SDK adapter"
```

---

## Task 2: Add `global_settings` migration and DB methods

**Files:**
- Create: `src-tauri/migrations/007_global_settings.sql`
- Modify: `src-tauri/src/lib.rs` (register migration)
- Modify: `src/lib/db.ts` (add `globalSettings` namespace)

**Step 1: Create migration file**

Create `src-tauri/migrations/007_global_settings.sql`:
```sql
CREATE TABLE IF NOT EXISTS global_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**Step 2: Register migration in Rust**

In `src-tauri/src/lib.rs`, find the `let migrations = vec![` block. After the last `Migration { version: 6, ... }` entry (before the closing `];`), add:

```rust
        Migration {
            version: 7,
            description: "global_settings",
            sql: include_str!("../migrations/007_global_settings.sql"),
            kind: MigrationKind::Up,
        },
```

**Step 3: Add `globalSettings` DB functions and namespace**

In `src/lib/db.ts`, add these two functions before the `// Public API` comment block (around line 864):

```typescript
// ---------------------------------------------------------------------------
// global_settings
// ---------------------------------------------------------------------------

async function globalSettingsGet(key: string): Promise<string | null> {
  const conn = await getDb();
  const rows = await conn.select<Array<{ value: string }>>(
    "SELECT value FROM global_settings WHERE key = $1",
    [key],
  );
  return rows[0]?.value ?? null;
}

async function globalSettingsSet(key: string, value: string): Promise<void> {
  const conn = await getDb();
  await conn.execute(
    `INSERT INTO global_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = $2`,
    [key, value],
  );
}
```

Then in the `export const db = { ... }` object, add a `globalSettings` namespace after `configOverrides`:

```typescript
  globalSettings: {
    get: globalSettingsGet,
    set: globalSettingsSet,
  },
```

**Step 4: Verify build**

```bash
bun run build
```
Expected: passes with no errors.

**Step 5: Commit**

```bash
git add src-tauri/migrations/007_global_settings.sql src-tauri/src/lib.rs src/lib/db.ts
git commit -m "feat(db): add global_settings table and db.globalSettings namespace"
```

---

## Task 3: Create the sidecar project and implement `index.ts`

**Files:**
- Create: `sidecar/agent-sdk-bridge/package.json`
- Create: `sidecar/agent-sdk-bridge/index.ts`

**Step 1: Create `sidecar/agent-sdk-bridge/package.json`**

```json
{
  "name": "agent-sdk-bridge",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "latest",
    "zod": "^3.24.1"
  }
}
```

> `zod` is a peer dependency required by `@anthropic-ai/claude-agent-sdk`.

**Step 2: Install dependencies**

```bash
cd sidecar/agent-sdk-bridge && bun install && cd ../..
```
Expected: `bun.lockb` created in `sidecar/agent-sdk-bridge/`, no errors.

**Step 3: Create `sidecar/agent-sdk-bridge/index.ts`**

```typescript
/**
 * Agent SDK Bridge — Bun sidecar
 *
 * Reads NDJSON query messages from stdin, runs them through
 * @anthropic-ai/claude-agent-sdk, and writes NDJSON SDKMessage
 * events to stdout.
 *
 * Protocol (one JSON object per line):
 *
 * stdin (Frontend → Sidecar):
 *   { "type": "query", "id": "<uuid>", "prompt": "...", "sessionId"?: "...", "model"?: "...", "cwd": "/path" }
 *   { "type": "interrupt", "queryId": "<uuid>" }
 *   { "type": "ping" }
 *
 * stdout (Sidecar → Frontend):
 *   { "type": "pong" }
 *   { "type": "message", "queryId": "<uuid>", "message": <SDKMessage> }
 *   { "type": "done",    "queryId": "<uuid>", "sessionId": "...", "costUsd": 0.0 }
 *   { "type": "error",   "queryId": "<uuid>", "error": "..." }
 */
import { createInterface } from "node:readline";
import { query } from "@anthropic-ai/claude-agent-sdk";

// Map of active queryId → AbortController for interrupt support
const activeAborts = new Map<string, AbortController>();

/** Write a JSON message to stdout, one object per line. */
function send(msg: object): void {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

/** Handle a single query: run the SDK generator, stream results. */
async function handleQuery(params: {
  id: string;
  prompt: string;
  sessionId?: string;
  model?: string;
  cwd?: string;
  maxTurns?: number;
}): Promise<void> {
  const { id, prompt, sessionId, model, cwd, maxTurns } = params;
  const abortController = new AbortController();
  activeAborts.set(id, abortController);

  let finalSessionId: string | undefined = sessionId;
  let totalCostUsd = 0;

  try {
    const sdkOptions: Record<string, unknown> = {
      abortController,
      ...(sessionId ? { resume: sessionId } : {}),
      ...(model ? { model } : {}),
      ...(cwd ? { cwd } : {}),
      ...(maxTurns != null ? { maxTurns } : {}),
    };

    for await (const message of query({ prompt, options: sdkOptions as never })) {
      // Forward every SDK message to the frontend as a "message" event
      send({ type: "message", queryId: id, message });

      // Track session ID and cost from system/result messages
      if (
        "session_id" in message &&
        typeof message.session_id === "string" &&
        message.session_id
      ) {
        finalSessionId = message.session_id;
      }
      if (message.type === "result" && "total_cost_usd" in message) {
        totalCostUsd = (message as { total_cost_usd?: number }).total_cost_usd ?? 0;
      }
    }

    send({
      type: "done",
      queryId: id,
      sessionId: finalSessionId ?? "",
      costUsd: totalCostUsd,
    });
  } catch (err) {
    // AbortError from interrupts is expected — still send done so the
    // frontend doesn't hang waiting for it.
    const isAbort =
      err instanceof Error &&
      (err.name === "AbortError" || err.message.includes("aborted"));

    if (isAbort) {
      send({
        type: "done",
        queryId: id,
        sessionId: finalSessionId ?? "",
        costUsd: totalCostUsd,
      });
    } else {
      send({
        type: "error",
        queryId: id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } finally {
    activeAborts.delete(id);
  }
}

// ---------------------------------------------------------------------------
// Main: read stdin line-by-line, dispatch messages
// ---------------------------------------------------------------------------

const rl = createInterface({ input: process.stdin, terminal: false });

rl.on("line", (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;

  let msg: { type: string; [key: string]: unknown };
  try {
    msg = JSON.parse(trimmed) as typeof msg;
  } catch {
    // Ignore unparseable lines
    return;
  }

  if (msg.type === "ping") {
    send({ type: "pong" });
    return;
  }

  if (msg.type === "interrupt") {
    const queryId = msg.queryId as string | undefined;
    if (queryId) {
      activeAborts.get(queryId)?.abort();
    }
    return;
  }

  if (msg.type === "query") {
    // Fire-and-forget — the async generator runs independently
    handleQuery({
      id: msg.id as string,
      prompt: msg.prompt as string,
      sessionId: msg.sessionId as string | undefined,
      model: msg.model as string | undefined,
      cwd: msg.cwd as string | undefined,
      maxTurns: msg.maxTurns as number | undefined,
    }).catch((err: unknown) => {
      process.stderr.write(
        `[agent-sdk-bridge] unhandled error in handleQuery: ${String(err)}\n`
      );
    });
    return;
  }
});

// Keep the process alive — readline keeps stdin open, but be explicit.
process.stdin.resume();

// Log startup to stderr (doesn't interfere with stdout NDJSON protocol)
process.stderr.write("[agent-sdk-bridge] ready\n");
```

**Step 4: Verify sidecar TypeScript (check-only, no compile yet)**

```bash
cd sidecar/agent-sdk-bridge && bun run --watch index.ts --help 2>&1 | head -5
```
Or just confirm the file exists and has no obvious import errors:
```bash
bun check sidecar/agent-sdk-bridge/index.ts
```
Expected: type errors may show for the `as never` cast on `sdkOptions` — this is intentional and acceptable. No missing module errors.

**Step 5: Commit**

```bash
git add sidecar/
git commit -m "feat(sidecar): add agent-sdk-bridge Bun sidecar"
```

---

## Task 4: Build the sidecar binary and configure Tauri

**Files:**
- Modify: `package.json` (root)
- Create: `src-tauri/binaries/.gitkeep`
- Create: `.gitignore` addition for binaries
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`

**Step 1: Add build scripts to root `package.json`**

In the root `package.json`, update the `"scripts"` section:

```json
"scripts": {
  "dev": "vite",
  "build:sidecar": "mkdir -p src-tauri/binaries && bun build --compile sidecar/agent-sdk-bridge/index.ts --outfile src-tauri/binaries/agent-sdk-bridge",
  "build": "bun run build:sidecar && tsc && vite build",
  "preview": "vite preview",
  "tauri": "tauri"
}
```

**Step 2: Build the sidecar binary**

```bash
bun run build:sidecar
```
Expected: binary created at `src-tauri/binaries/agent-sdk-bridge`. On macOS ARM this will be `agent-sdk-bridge` (~50–80 MB, self-contained Bun binary).

Verify it starts:
```bash
echo '{"type":"ping"}' | src-tauri/binaries/agent-sdk-bridge
```
Expected output:
```
{"type":"pong"}
```
(Then Ctrl-C to exit — it waits for more stdin.)

**Step 3: Set up `src-tauri/binaries/` for git**

```bash
mkdir -p src-tauri/binaries
touch src-tauri/binaries/.gitkeep
```

Add to `.gitignore` (append):
```
# Compiled sidecar binary — built via `bun run build:sidecar`
src-tauri/binaries/agent-sdk-bridge
src-tauri/binaries/agent-sdk-bridge-*
```

**Step 4: Add `externalBin` to `tauri.conf.json`**

In `src-tauri/tauri.conf.json`, in the `"bundle"` object, add `"externalBin"`:

```json
"bundle": {
  "active": true,
  "targets": "all",
  "externalBin": [
    "binaries/agent-sdk-bridge"
  ],
  "icon": [
    "icons/32x32.png",
    "icons/128x128.png",
    "icons/128x128@2x.png",
    "icons/icon.icns",
    "icons/icon.ico"
  ]
}
```

**Step 5: Add sidecar spawn permission to `capabilities/default.json`**

In `src-tauri/capabilities/default.json`, in the `"permissions"` array, add a new `shell:allow-spawn` entry for the sidecar:

```json
{
  "identifier": "shell:allow-spawn",
  "allow": [
    {
      "name": "binaries/agent-sdk-bridge",
      "sidecar": true
    }
  ]
}
```

> The `name` must match the path used in `Command.sidecar()` in TypeScript — `"binaries/agent-sdk-bridge"`.

**Step 6: Commit**

```bash
git add package.json src-tauri/binaries/.gitkeep .gitignore src-tauri/tauri.conf.json src-tauri/capabilities/default.json
git commit -m "feat(sidecar): add Tauri externalBin config and build script for agent-sdk-bridge"
```

---

## Task 5: Create `agent-sdk-adapter.ts`

This is the main frontend adapter. It manages the sidecar process lifecycle, routes queries over stdin, maps `SDKMessage` events into assistant-ui content parts, and pushes events to the shared DevPanel buffer.

**Files:**
- Create: `src/lib/agent-sdk-adapter.ts`

**Step 1: Create the file**

```typescript
/**
 * Agent SDK adapter for assistant-ui.
 *
 * Implements ChatModelAdapter by communicating with the agent-sdk-bridge
 * Bun sidecar over NDJSON on stdin/stdout via Tauri's shell plugin.
 *
 * The sidecar is spawned once (lazily on first query) and kept alive.
 * All queries are multiplexed over one channel using a per-query UUID.
 */
import { Command, type Child } from "@tauri-apps/plugin-shell";
import type { ChatModelAdapter, ChatModelRunResult } from "@assistant-ui/react";
import { db } from "@/lib/db";
import {
  extractUserPrompt,
  pushClaudeDevEvent,
  type ClaudeDevEventCategory,
  type SidecarSdkMessage,
} from "@/lib/claude-adapter";
import { resolveModel, getModelById, resolveEffort } from "@/lib/models";
import { homeDir } from "@tauri-apps/api/path";

const GLOBAL_THREAD_KEY = "__global__";
const LOG_PREFIX = "[agent-sdk-adapter]";
const DEV_LOGS = import.meta.env.DEV;

function log(...args: unknown[]): void {
  if (DEV_LOGS) console.log(LOG_PREFIX, ...args);
}

// ---------------------------------------------------------------------------
// Sidecar protocol types
// ---------------------------------------------------------------------------

type SidecarInbound =
  | { type: "query"; id: string; prompt: string; sessionId?: string; model?: string; cwd?: string; maxTurns?: number }
  | { type: "interrupt"; queryId: string }
  | { type: "ping" };

type SidecarOutbound =
  | { type: "pong" }
  | { type: "message"; queryId: string; message: SidecarSdkMessage }
  | { type: "done"; queryId: string; sessionId: string; costUsd: number }
  | { type: "error"; queryId: string; error: string };

// ---------------------------------------------------------------------------
// AgentSdkSidecar — manages the long-running sidecar process
// ---------------------------------------------------------------------------

class AgentSdkSidecar {
  private child: Child | null = null;
  private starting: Promise<Child> | null = null;
  private lineBuffer = "";

  /** Map from queryId → callbacks for routing stdout events. */
  private handlers = new Map<string, {
    onMessage: (msg: SidecarSdkMessage) => void;
    onDone: (sessionId: string, costUsd: number) => void;
    onError: (error: string) => void;
  }>();

  /** Per-thread mutex: a chained promise so queries on the same thread serialize. */
  private threadLocks = new Map<string, Promise<void>>();

  /** Acquire the per-thread lock. Returns a release function. */
  async acquireLock(threadKey: string): Promise<() => void> {
    const previous = this.threadLocks.get(threadKey) ?? Promise.resolve();
    let releaseFn!: () => void;
    const next = previous.then(() => new Promise<void>((resolve) => {
      releaseFn = resolve;
    }));
    this.threadLocks.set(threadKey, next);
    await previous;
    return releaseFn;
  }

  /** Ensure the sidecar is running. Returns the child process. */
  async ensureRunning(): Promise<Child> {
    if (this.child) return this.child;
    if (this.starting) return this.starting;

    this.starting = this._start();
    try {
      this.child = await this.starting;
      return this.child;
    } finally {
      this.starting = null;
    }
  }

  private async _start(): Promise<Child> {
    log("starting sidecar...");
    const command = Command.sidecar("binaries/agent-sdk-bridge");

    command.stdout.on("data", (data: string) => {
      this.lineBuffer += data;
      let idx = this.lineBuffer.indexOf("\n");
      while (idx >= 0) {
        const line = this.lineBuffer.slice(0, idx).trim();
        this.lineBuffer = this.lineBuffer.slice(idx + 1);
        if (line) this.handleLine(line);
        idx = this.lineBuffer.indexOf("\n");
      }
    });

    command.stderr.on("data", (data: string) => {
      log("sidecar stderr:", data.trim());
    });

    command.on("close", () => {
      log("sidecar process closed — will restart on next query");
      this.child = null;
      // Reject all pending handlers so callers don't hang
      for (const [queryId, h] of this.handlers) {
        h.onError("Sidecar process exited unexpectedly");
        this.handlers.delete(queryId);
      }
    });

    command.on("error", (err: string) => {
      console.error(LOG_PREFIX, "sidecar spawn error:", err);
      this.child = null;
    });

    const child = await command.spawn();
    log("sidecar started, pid:", child.pid);
    return child;
  }

  private handleLine(line: string): void {
    let msg: SidecarOutbound;
    try {
      msg = JSON.parse(line) as SidecarOutbound;
    } catch {
      log("non-JSON stdout line:", line.slice(0, 120));
      return;
    }

    if (msg.type === "pong") {
      log("pong received");
      return;
    }

    if (msg.type === "message" || msg.type === "done" || msg.type === "error") {
      const h = this.handlers.get(msg.queryId);
      if (!h) {
        log("no handler for queryId:", msg.queryId);
        return;
      }

      if (msg.type === "message") {
        h.onMessage(msg.message);
      } else if (msg.type === "done") {
        this.handlers.delete(msg.queryId);
        h.onDone(msg.sessionId, msg.costUsd);
      } else {
        this.handlers.delete(msg.queryId);
        h.onError(msg.error);
      }
    }
  }

  /** Send a message to the sidecar stdin. */
  async send(msg: SidecarInbound): Promise<void> {
    const child = await this.ensureRunning();
    await child.write(JSON.stringify(msg) + "\n");
  }

  /**
   * Run a query and return an async iterable of SDK messages.
   * Resolves when the sidecar sends "done" or "error".
   */
  streamQuery(params: {
    id: string;
    prompt: string;
    sessionId?: string;
    model?: string;
    cwd?: string;
    abortSignal: AbortSignal;
  }): AsyncIterable<{ message: SidecarSdkMessage } | { done: true; sessionId: string; costUsd: number }> {
    const { id, prompt, sessionId, model, cwd, abortSignal } = params;

    return {
      [Symbol.asyncIterator]() {
        const queue: Array<
          { message: SidecarSdkMessage } | { done: true; sessionId: string; costUsd: number } | { error: string }
        > = [];
        let resolveNext: (() => void) | null = null;
        let finished = false;

        function enqueue(item: typeof queue[number]) {
          queue.push(item);
          resolveNext?.();
          resolveNext = null;
        }

        // Register handlers before sending the query
        // (handlers are set by the caller via the sidecar instance)
        // We expose them via a side-channel below.
        return {
          // Store enqueue fn so the sidecar can call it
          _enqueue: enqueue,
          next(): Promise<IteratorResult<typeof queue[number]>> {
            if (queue.length > 0) {
              return Promise.resolve({ value: queue.shift()!, done: false });
            }
            if (finished) {
              return Promise.resolve({ value: undefined as never, done: true });
            }
            return new Promise((resolve) => {
              resolveNext = () => {
                if (queue.length > 0) {
                  resolve({ value: queue.shift()!, done: false });
                } else {
                  finished = true;
                  resolve({ value: undefined as never, done: true });
                }
              };
            });
          },
          return(): Promise<IteratorResult<typeof queue[number]>> {
            finished = true;
            resolveNext?.();
            return Promise.resolve({ value: undefined as never, done: true });
          },
        } as never;
      },
    };
  }

  /**
   * High-level: send a query and yield messages via an AsyncGenerator.
   */
  async *runQuery(params: {
    id: string;
    prompt: string;
    sessionId?: string;
    model?: string;
    cwd?: string;
    abortSignal: AbortSignal;
  }): AsyncGenerator<
    { message: SidecarSdkMessage } | { done: true; sessionId: string; costUsd: number },
    void
  > {
    const { id, prompt, sessionId, model, cwd, abortSignal } = params;

    // Promise-based queue bridged from callbacks
    const queue: Array<
      { message: SidecarSdkMessage }
      | { done: true; sessionId: string; costUsd: number }
      | { error: string }
    > = [];
    let notify: (() => void) | null = null;
    let finished = false;

    function push(item: typeof queue[number]) {
      queue.push(item);
      notify?.();
      notify = null;
    }

    this.handlers.set(id, {
      onMessage: (msg) => push({ message: msg }),
      onDone: (sid, cost) => { push({ done: true, sessionId: sid, costUsd: cost }); finished = true; },
      onError: (err) => { push({ error: err }); finished = true; },
    });

    // Wire abort
    const onAbort = () => {
      void this.send({ type: "interrupt", queryId: id });
    };
    if (abortSignal.aborted) {
      onAbort();
    } else {
      abortSignal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      await this.send({ type: "query", id, prompt, sessionId, model, cwd });

      while (true) {
        if (queue.length === 0) {
          if (finished) break;
          await new Promise<void>((r) => { notify = r; });
          continue;
        }

        const item = queue.shift()!;

        if ("error" in item) {
          throw new Error(item.error);
        }

        yield item;

        if ("done" in item) break;
      }
    } finally {
      abortSignal.removeEventListener("abort", onAbort);
      this.handlers.delete(id);
    }
  }
}

// Singleton sidecar — shared across all adapter instances
const sidecar = new AgentSdkSidecar();

// ---------------------------------------------------------------------------
// SDK message → assistant-ui content parts
// ---------------------------------------------------------------------------

function sdkMessageToContentParts(
  msg: SidecarSdkMessage,
): Array<{ type: "text"; text: string } | { type: "tool-call"; toolCallId: string; toolName: string; args: unknown; result?: unknown }> {
  if (msg.type !== "assistant" || !msg.message?.content) return [];

  const parts: ReturnType<typeof sdkMessageToContentParts> = [];

  for (const block of msg.message.content) {
    if (block.type === "text" && block.text) {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "tool_use" && block.id && block.name) {
      parts.push({
        type: "tool-call",
        toolCallId: block.id,
        toolName: block.name,
        args: block.input ?? {},
      });
    }
    // thinking blocks: emit as text for now
    if (block.type === "thinking" && block.thinking) {
      parts.push({ type: "text", text: `<thinking>\n${block.thinking}\n</thinking>` });
    }
  }

  return parts;
}

function sdkMessageCategory(msg: SidecarSdkMessage): ClaudeDevEventCategory {
  if (msg.type === "system") return msg.subtype === "init" ? "other" : "other";
  if (msg.type === "assistant" || msg.type === "user") return "messages";
  if (msg.type === "result") return "usage";
  return "other";
}

// ---------------------------------------------------------------------------
// createAgentSdkAdapter
// ---------------------------------------------------------------------------

export function createAgentSdkAdapter(): ChatModelAdapter {
  const cwdByThread = new Map<string, string>();
  const loadedThreadConfig = new Set<string>();

  return {
    async *run(options): AsyncGenerator<ChatModelRunResult, void> {
      const { messages, abortSignal } = options;
      const threadKey =
        (options as { unstable_threadId?: string }).unstable_threadId?.trim() ??
        GLOBAL_THREAD_KEY;

      // Load thread config (cwd, model) once per thread
      if (!loadedThreadConfig.has(threadKey)) {
        const thread = await db.threads.get(threadKey);
        const storedCwd = thread?.cwd?.trim();
        if (storedCwd) cwdByThread.set(threadKey, storedCwd);
        loadedThreadConfig.add(threadKey);
      }

      const prompt = extractUserPrompt(messages);
      if (!prompt.trim()) return;

      // Resolve session + model
      const sessionRow = await db.sessions.get(threadKey);
      const sessionId = sessionRow?.session_id ?? undefined;

      const threadRow = await db.threads.get(threadKey);
      const model = resolveModel(threadRow?.model ?? null);
      const modelDef = getModelById(model);
      const effort = resolveEffort(threadRow?.effort ?? null);
      void effort; // effort not yet exposed in Agent SDK options; reserved for future

      // Resolve CWD
      let cwd = cwdByThread.get(threadKey);
      if (!cwd) {
        try { cwd = await homeDir(); } catch { /* leave undefined */ }
      }

      // Acquire per-thread lock so concurrent UI presses serialize
      const release = await sidecar.acquireLock(threadKey);

      try {
        const queryId = crypto.randomUUID();
        log("starting query:", queryId, { sessionId, model, cwd });

        let finalSessionId: string | null = null;
        let pendingContent: ReturnType<typeof sdkMessageToContentParts> = [];
        let devSeq = 0;

        for await (const item of sidecar.runQuery({
          id: queryId,
          prompt,
          sessionId,
          model: modelDef ? model : undefined,
          cwd,
          abortSignal,
        })) {
          if ("done" in item) {
            finalSessionId = item.sessionId || null;

            // Flush any remaining content
            if (pendingContent.length > 0) {
              yield {
                content: pendingContent,
                status: { type: "complete", reason: "stop" },
              } satisfies ChatModelRunResult;
              pendingContent = [];
            }

            // Persist session
            if (finalSessionId) {
              await db.sessions.upsert({
                thread_id: threadKey,
                session_id: finalSessionId,
                status: "active",
                last_updated_at: new Date().toISOString(),
              });
            }
            break;
          }

          // It's a message event
          const sdkMsg = item.message;

          // Push to DevPanel
          pushClaudeDevEvent({
            id: `sdk-${queryId}-${devSeq++}`,
            at: Date.now(),
            threadKey,
            raw: JSON.stringify(sdkMsg),
            parsed: {
              type: sdkMsg.type as "assistant" | "user" | "result" | "system",
              subtype: sdkMsg.subtype,
              session_id: sdkMsg.session_id,
              result: sdkMsg.result,
              total_cost_usd: sdkMsg.total_cost_usd,
              usage: sdkMsg.usage,
            } as never,
            category: sdkMessageCategory(sdkMsg),
            sdkMessage: sdkMsg,
          });

          // Map assistant messages → content parts
          const parts = sdkMessageToContentParts(sdkMsg);
          if (parts.length > 0) {
            pendingContent = parts;
            yield { content: parts } satisfies ChatModelRunResult;
          }
        }
      } catch (err) {
        if (abortSignal.aborted) {
          // Normal cancellation — yield cancelled status
          yield {
            content: [],
            status: { type: "incomplete", reason: "cancelled" },
          } satisfies ChatModelRunResult;
        } else {
          throw err;
        }
      } finally {
        release();
      }
    },
  };
}
```

**Step 2: Verify TypeScript compiles**

```bash
bun run build
```
Expected: no errors. If there are type errors in the `parsed: ... as never` cast area, that's acceptable — the cast bridges our internal `SidecarSdkMessage` type to the narrower `ClaudeStreamEvent` type that `ClaudeDevEvent.parsed` expects. You can also cast as `as unknown as ClaudeStreamEvent`.

**Step 3: Commit**

```bash
git add src/lib/agent-sdk-adapter.ts
git commit -m "feat: add agent-sdk-adapter.ts — ChatModelAdapter backed by sidecar"
```

---

## Task 6: Update `RuntimeProvider.tsx` to conditionally use either adapter

**Files:**
- Modify: `src/components/RuntimeProvider.tsx`

**Step 1: Replace the file contents**

```typescript
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  unstable_useRemoteThreadListRuntime as useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { createClaudeAdapter } from "@/lib/claude-adapter";
import { createAgentSdkAdapter } from "@/lib/agent-sdk-adapter";
import { createSQLiteThreadListAdapter } from "@/lib/sqlite-thread-list-adapter";
import { db } from "@/lib/db";

const threadListAdapter = createSQLiteThreadListAdapter();

export type AdapterType = "shell" | "agent-sdk";

/** Read the persisted adapter type from SQLite once on mount. */
function useAdapterType(): AdapterType {
  const [adapterType, setAdapterType] = useState<AdapterType>("shell");

  useEffect(() => {
    db.globalSettings.get("adapter_type").then((value) => {
      if (value === "agent-sdk") setAdapterType("agent-sdk");
    }).catch((err) => {
      console.warn("[RuntimeProvider] failed to read adapter_type setting:", err);
    });
  }, []);

  return adapterType;
}

/** Inner hook — creates the per-thread local runtime with the selected adapter. */
function useRuntimeHook(adapterType: AdapterType) {
  const adapter = useMemo(
    () =>
      adapterType === "agent-sdk"
        ? createAgentSdkAdapter()
        : createClaudeAdapter(),
    [adapterType],
  );
  return useLocalRuntime(adapter);
}

/**
 * Provides the assistant-ui runtime context with SQLite-backed
 * thread list persistence and per-thread message history.
 *
 * The adapter (shell vs Agent SDK) is determined by the `adapter_type`
 * setting in `global_settings` and takes effect on next startup when changed.
 */
export function RuntimeProvider({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  const adapterType = useAdapterType();

  const runtime = useRemoteThreadListRuntime({
    runtimeHook: () => useRuntimeHook(adapterType),
    adapter: threadListAdapter,
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider>{children}</TooltipProvider>
    </AssistantRuntimeProvider>
  );
}
```

**Step 2: Verify TypeScript compiles**

```bash
bun run build
```
Expected: passes. If you get a React hooks rule violation for the `runtimeHook` prop calling `useRuntimeHook(adapterType)`, wrap it in an inline arrow function: `runtimeHook: () => useRuntimeHook(adapterType)` — which is already how it's written above.

**Step 3: Commit**

```bash
git add src/components/RuntimeProvider.tsx
git commit -m "feat(runtime): conditionally instantiate shell or Agent SDK adapter from global_settings"
```

---

## Task 7: Add Engine toggle to `settings-overlay.tsx`

**Files:**
- Modify: `src/components/settings-overlay.tsx`

**Step 1: Import `AdapterType` and `db`**

At the top of `settings-overlay.tsx`, find the existing imports and add:
```typescript
import { db } from "@/lib/db";
import type { AdapterType } from "@/components/RuntimeProvider";
```
`db` is likely already imported. Just add the `AdapterType` import.

**Step 2: Add Engine state near the top of `SettingsOverlay`**

Inside `SettingsOverlay`, after the existing state declarations (around line 407–412 in the original):

```typescript
  const [adapterType, setAdapterType] = useState<AdapterType>("shell");
  const [adapterChanged, setAdapterChanged] = useState(false);

  // Load current adapter setting
  useEffect(() => {
    if (!open) return;
    db.globalSettings.get("adapter_type").then((v) => {
      setAdapterType(v === "agent-sdk" ? "agent-sdk" : "shell");
    }).catch(console.error);
  }, [open]);

  const handleAdapterChange = async (next: AdapterType) => {
    setAdapterType(next);
    await db.globalSettings.set("adapter_type", next);
    setAdapterChanged(true);
  };
```

**Step 3: Add the Engine row in the JSX, between the header and the `<TabBar />`**

Find the line that renders `<TabBar .../>` and add the Engine row **immediately before it**:

```tsx
        {/* Engine selector */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-2">
          <span className="text-[0.69rem] font-semibold uppercase tracking-[0.11em] text-muted-foreground">
            Engine
          </span>
          <div className="flex items-center gap-1.5">
            {(["shell", "agent-sdk"] as AdapterType[]).map((opt) => (
              <button
                key={opt}
                type="button"
                onClick={() => void handleAdapterChange(opt)}
                className={cn(
                  "rounded px-2.5 py-1 font-mono text-[0.72rem] transition-colors duration-120",
                  adapterType === opt
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {opt === "shell" ? "Shell (Claude CLI)" : "Agent SDK"}
              </button>
            ))}
          </div>
          {adapterChanged && (
            <span className="font-mono text-[0.64rem] text-muted-foreground/70">
              Restart to apply
            </span>
          )}
        </div>
```

**Step 4: Verify TypeScript compiles**

```bash
bun run build
```
Expected: passes with no type errors.

**Step 5: Commit**

```bash
git add src/components/settings-overlay.tsx
git commit -m "feat(settings): add Engine toggle for shell vs Agent SDK adapter"
```

---

## Task 8: Update `DevPanel.tsx` to render SDK messages

**Files:**
- Modify: `src/components/DevPanel.tsx`

**Step 1: Import `SidecarSdkMessage`**

In `DevPanel.tsx`, update the import from `@/lib/claude-adapter`:

```typescript
import {
  clearClaudeDevSnapshot,
  getClaudeDevSnapshot,
  getClaudeSessionRecords,
  refreshClaudeSessionRecords,
  subscribeClaudeDevSnapshot,
  subscribeClaudeSessionRecords,
  type ClaudeDevEvent,
  type ClaudeDevEventCategory,
  type SidecarSdkMessage,
} from "@/lib/claude-adapter";
```

**Step 2: Find the event row renderer**

Locate the component or function that renders a single `ClaudeDevEvent` row in the DevPanel. It will be somewhere in `DevPanel.tsx` and reference `event.parsed.type` or `event.category`. Add a branch at the top that handles the `sdkMessage` field:

Look for something like:
```tsx
function EventRow({ event }: { event: ClaudeDevEvent }) {
```

Inside it, add an early branch:
```tsx
  // Agent SDK mode: render SDK-native message shape
  if (event.sdkMessage) {
    return <SdkEventRow event={event} msg={event.sdkMessage} />;
  }
```

**Step 3: Add `SdkEventRow` component**

Add this component above `EventRow` (or wherever the event rendering components are defined):

```tsx
function SdkEventRow({
  event,
  msg,
}: {
  event: ClaudeDevEvent;
  msg: SidecarSdkMessage;
}) {
  const label = msg.subtype ? `${msg.type}:${msg.subtype}` : msg.type;
  const timeStr = new Date(event.at).toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });

  return (
    <div className="flex items-start gap-2 px-3 py-1.5 font-mono text-[0.68rem] border-b border-border/40">
      <span className="shrink-0 text-muted-foreground/60">{timeStr}</span>
      <Badge variant="outline" className="shrink-0 text-[0.6rem] px-1 py-0 h-4 font-mono">
        SDK
      </Badge>
      <span className="shrink-0 font-medium text-foreground/80">{label}</span>
      {msg.type === "result" && msg.total_cost_usd != null && (
        <span className="text-muted-foreground">
          ${msg.total_cost_usd.toFixed(4)} · {msg.usage?.input_tokens ?? 0}in / {msg.usage?.output_tokens ?? 0}out
        </span>
      )}
      {msg.type === "system" && msg.subtype === "init" && msg.session_id && (
        <span className="truncate text-muted-foreground">session: {msg.session_id.slice(0, 8)}…</span>
      )}
    </div>
  );
}
```

**Step 4: Verify TypeScript compiles**

```bash
bun run build
```
Expected: passes. Adjust the exact JSX structure to match where existing event rows are rendered in the real DevPanel code — the key point is the `if (event.sdkMessage)` early-return branch.

**Step 5: Commit**

```bash
git add src/components/DevPanel.tsx
git commit -m "feat(devpanel): render SDK message events with SdkEventRow component"
```

---

## Task 9: Integration test — manual verification

**Step 1: Start the app in dev mode**

```bash
cargo tauri dev
```
Expected: app window opens, existing shell adapter works normally. Send a test message and confirm you see a response.

**Step 2: Open Settings → toggle Engine to "Agent SDK"**

- Click the settings icon or shortcut to open Settings overlay.
- Verify the "Engine" row appears between the header and the MCP/Skills tabs.
- Click "Agent SDK". Verify the button highlights and "Restart to apply" text appears.

**Step 3: Restart the app**

Close the `cargo tauri dev` window (Ctrl-C) and relaunch:
```bash
cargo tauri dev
```

**Step 4: Verify Agent SDK adapter is active**

Open DevPanel (if available in dev mode). Send a simple test message like:
```
What is 2 + 2?
```
Expected observations:
- The response streams in correctly.
- DevPanel shows events with the "SDK" badge.
- The event types are `system:init`, `assistant`, `result` rather than raw CLI stream event types.

**Step 5: Check session persistence**

Send a follow-up message:
```
What did I just ask you?
```
Expected: Claude references "2 + 2" — proving the session was resumed correctly via the SDK's `resume` option.

**Step 6: Test abort**

Start sending a long-running message and click the stop button mid-stream. Expected: generation stops, no hung sidecar process, app remains responsive.

**Step 7: Switch back to shell adapter**

Open Settings, toggle back to "Shell (Claude CLI)", restart. Send a message. Expected: works exactly as before, DevPanel shows raw CLI events without "SDK" badge.

**Step 8: Commit (if any fixups were needed)**

```bash
git add -p
git commit -m "fix: integration fixups from manual testing"
```

---

## Summary of all files touched

| File | Action |
|---|---|
| `src/lib/claude-adapter.ts` | Export `extractUserPrompt`, `pushClaudeDevEvent`, add `SidecarSdkMessage` interface, add `sdkMessage?` to `ClaudeDevEvent` |
| `src-tauri/migrations/007_global_settings.sql` | Create |
| `src-tauri/src/lib.rs` | Register migration 007 |
| `src/lib/db.ts` | Add `globalSettings` DB functions + namespace |
| `sidecar/agent-sdk-bridge/package.json` | Create |
| `sidecar/agent-sdk-bridge/index.ts` | Create |
| `package.json` | Add `build:sidecar` script, update `build` |
| `src-tauri/binaries/.gitkeep` | Create |
| `.gitignore` | Add binaries entry |
| `src-tauri/tauri.conf.json` | Add `externalBin` |
| `src-tauri/capabilities/default.json` | Add sidecar spawn permission |
| `src/lib/agent-sdk-adapter.ts` | Create |
| `src/components/RuntimeProvider.tsx` | Read setting, conditionally instantiate adapter, export `AdapterType` |
| `src/components/settings-overlay.tsx` | Add Engine toggle row |
| `src/components/DevPanel.tsx` | Import `SidecarSdkMessage`, add `SdkEventRow` branch |
