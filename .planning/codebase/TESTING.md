# Testing Patterns

**Analysis Date:** 2026-03-05

## Test Framework

**Runner:**
- **No test framework is configured.** There is no jest, vitest, playwright, or any other test runner in the project.
- No test configuration files exist (`jest.config.*`, `vitest.config.*`, `playwright.config.*`)
- No test scripts in `package.json`

**Assertion Library:**
- None installed

**Run Commands:**
```bash
# No test commands available
# The project has zero test infrastructure
```

## Test File Organization

**Location:**
- No test files exist anywhere in the `src/` directory
- No `__tests__/` directories, no `*.test.*` or `*.spec.*` files in project source

**Naming:**
- No convention established

## Test Structure

**No tests exist.** The entire application -- including the core adapters, DB layer, stream parsers, and UI components -- is untested.

## Mocking

**Framework:** None

**Patterns:**
- No mocking patterns established
- The codebase relies heavily on Tauri shell plugin (`Command.create()`), `@tauri-apps/plugin-sql`, and Tauri event system (`listen()`/`invoke()`) -- all of which would need mocking infrastructure for unit tests

**What Would Need Mocking:**
- `@tauri-apps/plugin-shell` `Command.create()` and `Command.sidecar()` -- spawns CLI processes
- `@tauri-apps/plugin-sql` `Database.load()` -- SQLite connection
- `@tauri-apps/api/core` `invoke()` -- Tauri command bridge
- `@tauri-apps/api/event` `listen()` -- Tauri event subscriptions
- `@tauri-apps/api/path` `homeDir()` -- OS path resolution

## Fixtures and Factories

**Test Data:**
- No test fixtures or factories exist
- DB row types are well-defined in `src/lib/db.ts` (`ThreadRow`, `MessageRow`, `SessionRow`, etc.) which would serve as the basis for test factories

**Location:**
- Not applicable

## Coverage

**Requirements:** None enforced

**View Coverage:**
```bash
# No coverage tooling configured
```

## Test Types

**Unit Tests:**
- Not implemented
- Good candidates for unit testing:
  - `src/lib/db.ts` -- pure SQL operations (would need SQLite mock or in-memory DB)
  - `src/lib/models.ts` -- `resolveModel()`, `resolveEffort()`, `isCodexModel()`, `getModelById()` are pure functions
  - `src/lib/workspace-repo-metadata.ts` -- `parseRepoSlug()` (internal helper, currently not exported)
  - `src/lib/dev-event-batcher.ts` -- batching/flushing logic
  - `src/lib/thread-status-store.ts` -- Zustand store state transitions
  - Stream event parsing logic in `src/lib/claude-adapter.ts`

**Integration Tests:**
- Not implemented
- The adapter layer (`src/lib/claude-adapter.ts`, `src/lib/agent-sdk-adapter.ts`, `src/lib/codex-adapter.ts`) would benefit from integration tests with mocked CLI processes

**E2E Tests:**
- Not implemented
- No Playwright, Cypress, or WebDriver configuration
- Tauri has `@tauri-apps/api/mocks` for WebView testing but it is not installed

## Common Patterns

**Async Testing:**
- Not established. The codebase is heavily async (all DB operations, CLI spawning, stream processing) so any future test setup must handle async patterns well.

**Error Testing:**
- Not established. Custom error class `DuplicateWorkspaceCwdError` in `src/lib/db.ts` would be a good target for error-path testing.

## Recommended Test Setup

If adding tests, based on the tech stack:

**Framework choice:** Vitest (aligns with Vite build system already in use)

**Configuration location:** `vitest.config.ts` at project root

**Suggested structure:**
```
src/
  lib/
    __tests__/
      models.test.ts
      db.test.ts
      thread-status-store.test.ts
      dev-event-batcher.test.ts
  components/
    __tests__/
      ...
```

**Mocking approach:**
- Use `vi.mock()` for Tauri plugin imports
- Create a `src/test/` directory for shared test utilities and Tauri API mocks
- Consider `better-sqlite3` or an in-memory adapter for DB layer tests

**Priority test targets (by risk):**
1. `src/lib/models.ts` -- Pure functions, easy to test, zero mocking needed
2. `src/lib/thread-status-store.ts` -- Zustand store, minimal mocking
3. `src/lib/db.ts` -- Core data layer, needs SQLite mock
4. `src/lib/claude-adapter.ts` -- Stream parsing logic (extract pure functions first)

---

*Testing analysis: 2026-03-05*
