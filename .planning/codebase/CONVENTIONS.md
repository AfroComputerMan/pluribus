# Coding Conventions

**Analysis Date:** 2026-03-05

## Naming Patterns

**Files:**
- Use **kebab-case** for all file names: `claude-adapter.ts`, `thread-status-store.ts`, `tooltip-icon-button.tsx`
- React component files use `.tsx` extension; pure logic files use `.ts`
- shadcn/ui components live in `src/components/ui/` with their original kebab-case names: `button.tsx`, `dialog.tsx`

**Functions:**
- Use **camelCase** for all functions: `createRouterAdapter()`, `resolveModel()`, `threadsCreate()`
- Factory functions use `create` prefix: `createRouterAdapter()`, `createSQLiteThreadListAdapter()`, `createAgentSdkAdapter()`, `createCodexAdapter()`
- Boolean-returning functions use `is` prefix: `isCodexModel()`, `isMissingTableError()`
- DB layer functions use entity prefix + verb: `threadsGet()`, `sessionsUpsert()`, `devEventsInsertBatch()`

**Variables:**
- Use **camelCase** for variables and parameters
- Module-level constants use **UPPER_SNAKE_CASE**: `GLOBAL_THREAD_KEY`, `MAX_DEV_EVENTS`, `YIELD_THROTTLE_MS`, `DEFAULT_MODEL_ID`
- Module-level mutable singletons use **camelCase**: `dbInstance`, `devEventSeq`, `sessionByThread`
- Exported constant arrays use **UPPER_SNAKE_CASE**: `CLAUDE_MODELS`, `EFFORT_LEVELS`, `CODEX_EFFORT_LEVELS`

**Types/Interfaces:**
- Use **PascalCase** for all types and interfaces: `ThreadRow`, `ClaudeStreamEvent`, `WorkspaceRepoMeta`
- DB row types use `*Row` suffix: `ThreadRow`, `MessageRow`, `SessionRow`, `McpSnapshotRow`
- Discriminated union event types use descriptive suffix: `ClaudeSystemEvent`, `ClaudeContentBlockStartEvent`
- Component prop types use `*Props` suffix: `TooltipIconButtonProps`, `SettingsOverlayProps`
- Store state interfaces use `*State` suffix: `ThreadStatusState`

**React Components:**
- Use **PascalCase**: `Thread`, `ThreadWorkspace`, `RuntimeProvider`, `ComposerAction`
- Exported components use named exports (not default), except `App` which uses default export
- Internal sub-components within a file are `const` arrow functions with `FC` type: `const Composer: FC = () => { ... }`

## Code Style

**Formatting:**
- No Prettier or ESLint configured at the project level -- formatting is manual/editor-driven
- Double quotes for strings throughout (consistent across all source files)
- Semicolons used inconsistently -- most files omit trailing semicolons on simple statements in `src/lib/utils.ts` but use them elsewhere. **Prefer semicolons** as the dominant pattern across the codebase
- 2-space indentation throughout
- Trailing commas in multi-line arrays, objects, and parameter lists

**Linting:**
- TypeScript strict mode enforced via `tsconfig.json`: `strict: true`, `noUnusedLocals: true`, `noUnusedParameters: true`, `noFallthroughCasesInSwitch: true`
- No standalone linter (ESLint/Biome) is configured -- TypeScript compiler is the only static analysis tool

## Import Organization

**Order:**
1. External library imports (React, assistant-ui, tauri, lucide, etc.)
2. Internal `@/` path alias imports (components, lib, hooks)
3. Type-only imports use `import type { ... }` syntax

**Path Aliases:**
- `@/*` maps to `src/*` (configured in `tsconfig.json` and `vite.config.ts`)
- Always use `@/` for internal imports: `@/lib/db`, `@/components/ui/button`, `@/hooks/use-media-query`
- Never use relative paths for cross-directory imports

**Type Imports:**
- Use `import type` for type-only imports: `import type { ChatModelAdapter } from "@assistant-ui/react"`
- Use inline `type` keyword when mixing values and types: `import { db, type ThreadRow } from "@/lib/db"`

## Error Handling

**Patterns:**
- **try/catch with rethrow**: Catch errors, log or transform, then rethrow. See `src/lib/codex-adapter.ts` router adapter pattern
- **Fire-and-forget with `.catch()`**: Async operations that should not block use `void fn().catch(...)`. See `src/lib/dev-event-batcher.ts`:
  ```typescript
  void db.devEvents.insertBatch(batch).catch((err) => {
    console.error("[dev-event-archive] batch insert failed:", err);
  });
  ```
- **Cancelled flag pattern**: All async effects in React use a `cancelled` boolean to prevent state updates after unmount:
  ```typescript
  useEffect(() => {
    let cancelled = false;
    someAsyncFn().then((result) => {
      if (!cancelled) setState(result);
    }).catch(() => {
      if (!cancelled) setState(fallback);
    });
    return () => { cancelled = true; };
  }, [deps]);
  ```
- **Nullish coalescing for DB results**: `rows[0] ?? null` is the standard pattern for single-row queries in `src/lib/db.ts`
- **Custom error classes** for domain errors: `DuplicateWorkspaceCwdError` in `src/lib/db.ts`
- **`instanceof Error` checks**: Used for safe error message extraction:
  ```typescript
  const message = cause instanceof Error ? cause.message : "Failed to select workspace.";
  ```

## Logging

**Framework:** `console` (no logging library)

**Patterns:**
- Dev-only logging uses a conditional guard:
  ```typescript
  const DEV_LOGS = import.meta.env.DEV;
  function devLog(...args: unknown[]): void {
    if (DEV_LOGS) console.log(...args);
  }
  ```
- Log prefixes in brackets identify the module: `[agent-sdk-adapter]`, `[dev-event-archive]`, `[agent-permission-request]`
- Error logging always uses `console.error()`  regardless of dev mode
- Sidecar (Bun) uses `process.stderr.write()` for logging since stdout is the data channel

## Comments

**When to Comment:**
- Use JSDoc-style `/** ... */` comments for exported functions and public interfaces
- Use section dividers with dashes for logical groupings in large files:
  ```typescript
  // ---------------------------------------------------------------------------
  // threads
  // ---------------------------------------------------------------------------
  ```
- Use inline `//` comments for non-obvious logic or workarounds
- Use `TODO(author):` format for known issues: `// TODO(noahr): Duplicate workspace detection...`

**JSDoc/TSDoc:**
- Use `/** ... */` on exported functions. Keep descriptions to 1-2 lines
- Do not use `@param` or `@returns` tags -- rely on TypeScript types instead
- Example from `src/lib/db.ts`:
  ```typescript
  /** Get or initialize the database singleton. Thread-safe via promise dedup. */
  export async function getDb(): Promise<Database> { ... }
  ```

## Function Design

**Size:**
- Utility functions are short (< 20 lines): `cn()`, `formatInt()`, `normalizeCwd()`
- Adapter `run()` generators can be very long (the main claude-adapter.ts `run()` is hundreds of lines) -- this is accepted for stream processing but flagged as tech debt

**Parameters:**
- Use options objects for functions with > 2-3 optional parameters:
  ```typescript
  async function threadsCreate(id: string, opts?: { cwd?: string | null; workspaceId?: string | null; ... })
  ```
- Use explicit `null` (not `undefined`) for nullable DB fields

**Return Values:**
- Single-row DB queries return `T | null` (never `undefined`)
- List queries return `T[]` (never `null`)
- Void async operations return `Promise<void>`
- Adapters return `ChatModelAdapter` (assistant-ui interface)

## Module Design

**Exports:**
- Prefer named exports over default exports
- Only `src/App.tsx` uses `export default`
- Group related functions under a namespaced const object for the DB layer:
  ```typescript
  export const db = {
    threads: { list, get, create, ... },
    messages: { loadByThread, append, ... },
  } as const;
  ```

**Barrel Files:**
- Not used. Import directly from the source file

**Singleton Pattern:**
- Module-level singletons with lazy initialization:
  ```typescript
  let dbInstance: Database | null = null;
  let dbPromise: Promise<Database> | null = null;
  ```
- Promise deduplication for one-time initialization (see `getDb()`, `ensureMcpInvocationsTable()`)

## State Management

**Zustand stores:**
- Use `create<StateType>()` with get/set pattern: `src/lib/thread-status-store.ts`
- Export the hook directly: `export const useThreadStatusStore = create<ThreadStatusState>(...)`
- Access store outside React via `.getState()`: `useThreadStatusStore.getState().setStatus(...)`

**In-memory Maps/Sets:**
- Used extensively for runtime state in adapter files: `sessionByThread`, `activeChildByThread`, `activeThreadRuns`
- Module-scoped (not exported) for internal state

**useSyncExternalStore:**
- Used for bridging non-React state (permission requests) into React: see `src/components/assistant-ui/thread.tsx` `PermissionApprovalBar`

## Component Philosophy

- **UI primitives**: Always use shadcn/ui or Radix. Never build custom buttons, dialogs, popovers, etc.
- **Chat primitives**: Always use assistant-ui primitives (`ThreadPrimitive`, `MessagePrimitive`, `ComposerPrimitive`, `ActionBarPrimitive`, `ChainOfThoughtPrimitive`). Wrap and compose them, do not replace them.
- **Icons**: Use lucide-react exclusively. Import individual icons: `import { ArrowDownIcon } from "lucide-react"`
- **Styling**: Tailwind utility classes via `className`. Use `cn()` from `@/lib/utils` for conditional class merging. Custom CSS classes prefixed with `aui-` for assistant-ui theme hooks.
- **Conditional rendering**: Use ternary with `null` (`condition ? <Component /> : null`), not `&&` short-circuit

---

*Convention analysis: 2026-03-05*
