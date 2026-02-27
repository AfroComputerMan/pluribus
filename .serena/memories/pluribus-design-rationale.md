# Design Rationale & Trade-offs

## Why `sh -c` Instead of Direct `Command.create("claude", [...])`?

Claude CLI detects whether stdin is a **pipe or TTY**. When Tauri's `Command.create` spawns a process directly, stdin appears as a pipe — Claude CLI then **blocks waiting for piped input** before producing any output. The `sh -c ... < /dev/null` wrapper forces immediate stdin EOF, which tells Claude CLI "no interactive input, just use `-p` prompt." The `exec` in the shell script replaces the `sh` process with `claude`, so there's no lingering parent shell.

**Trade-off:** This creates a security surface (arbitrary `sh -c` execution). The mitigation is passing the user prompt via `CLAUDE_PROMPT` env var rather than interpolating it into the shell command string. A future improvement would be finding a way to close stdin on Tauri's `Command.create` directly.

## Why Module-Level Maps Instead of React State or Zustand?

The adapter runs **outside React's render cycle**. It's an async generator that yields content to assistant-ui's runtime. Module-level `Map`s (`sessionByThread`, `cwdByThread`, `activeChildByThread`) provide:
1. **Direct access from async generator context** — no hook rules to worry about
2. **Shared state across multiple adapter instances** — when RuntimeProvider remounts on thread switch, the maps survive
3. **Process lifecycle outlives components** — a CLI process may still be streaming when components unmount

React state would be destroyed on remount, and Zustand would add unnecessary indirection for state that's never rendered directly.

## Why a Circular Buffer for Dev Events (Not Array.push)?

The dev event stream is **unbounded** — a long Claude session can emit thousands of events. A naive `push()` would grow memory indefinitely. The circular buffer (500 entries, implemented as a flat array with head/count pointers) provides:
1. **O(1) insertion** — no array shifting or GC pressure
2. **Bounded memory** — exactly 500 events max
3. **Oldest-first eviction** — when full, overwrites the oldest entry
4. **Snapshot caching** — `devEventsVersion` tracking avoids reconstructing the snapshot array unless the buffer changed, which is critical for `useSyncExternalStore` performance

## Why `useSyncExternalStore` for DevPanel?

The dev event buffer lives outside React. `useSyncExternalStore` is the React 18+ way to subscribe to external mutable state without causing tearing (inconsistent reads between concurrent renders). The subscription pattern (subscribe → listener set, getSnapshot → version-cached array) is the canonical approach.

## Why Only the Last User Message Is Sent?

Claude CLI manages its own conversation history via `--resume` and `--session-id`. The adapter deliberately sends only the latest user prompt to avoid **double-history**: if Pluribus sent the full message array AND Claude CLI replayed its own session, the LLM would see duplicated context. This means Pluribus's message history (SQLite) and Claude CLI's session history can **diverge** on edit/branch/regenerate operations — a known architectural limitation.

## Why `RemoteThreadListAdapter` Over Local Thread Management?

assistant-ui's `useLocalRuntime` provides basic thread management, but `useRemoteThreadListRuntime` adds:
1. **Server-side thread list** — threads persist across app restarts (via SQLite)
2. **Async operations** — thread creation can perform I/O (workspace assignment, git metadata)
3. **Title generation** — the adapter can spawn a concurrent Haiku call for auto-titles

The earlier approach used a custom thread manager with `key={activeThread.id}` on RuntimeProvider, which caused full remounts on thread switch. The `RemoteThreadListAdapter` is the framework-recommended replacement.

## Why SQLite Over localStorage/IndexedDB?

1. **Tauri-native** — `tauri-plugin-sql` provides a mature, migration-aware SQLite layer
2. **Structured queries** — foreign keys, indexes, cascading deletes, batch inserts
3. **Cross-platform** — SQLite file works identically on Linux/macOS/Windows
4. **Atomic operations** — WAL mode enables concurrent reads during writes
5. **No size limits** — localStorage caps at ~5MB; message history can grow much larger
