# Pluribus Comprehensive Audit Report

**Audited by**: Frontend UI/UX Expert, Backend Rust/Tauri Expert, Security & Performance Expert, AI Integration Expert
**Date**: 2026-02-18
**Codebase**: Pluribus -- Tauri 2 + React 19 desktop app (Claude CLI frontend)

---

## Executive Summary

Four expert auditors independently reviewed every file in the Pluribus codebase. The audit identified **4 Critical**, **7 High**, **19 Medium**, and **22 Low** severity issues across security, performance, UI/UX, and AI integration domains.

**The two most urgent findings:**

1. **XSS via `dangerouslySetInnerHTML`** in tool display -- Claude CLI output rendered as raw HTML could enable arbitrary code execution in the Tauri webview
2. **Unrestricted `sh` execution** -- Tauri capabilities grant `"args": true` to the system shell, meaning any webview compromise becomes full system access

**The most impactful positive finding:** The codebase has evolved significantly beyond what CLAUDE.md documents -- the old `key={activeThread.id}` runtime destruction pattern has been replaced with proper `useRemoteThreadListRuntime` + SQLite persistence, which is a major architectural improvement.

---

## Table of Contents

1. [Critical Issues](#critical-issues-fix-before-any-release)
2. [High Severity Issues](#high-severity-issues)
3. [Medium Severity Issues](#medium-severity-issues)
4. [Low Severity Issues](#low-severity-issues)
5. [Positive Findings](#positive-findings)
6. [Frontend UI/UX Detailed Findings](#frontend-uiux-detailed-findings)
7. [Backend Rust/Tauri Detailed Findings](#backend-rusttauri-detailed-findings)
8. [Security & Performance Detailed Findings](#security--performance-detailed-findings)
9. [AI Integration Detailed Findings](#ai-integration-detailed-findings)
10. [Priority Remediation Roadmap](#priority-remediation-roadmap)

---

## Critical Issues (Fix Before Any Release)

### CRIT-1: XSS via `dangerouslySetInnerHTML` in HighlightedCode

- **File**: `src/components/assistant-ui/claude-tool-display.tsx:283`
- **Found by**: Security Expert
- **CVSS**: 8.1

Tool results from Claude CLI (file contents, command output) are rendered via `dangerouslySetInnerHTML={{ __html: html }}` after passing through `hljs.highlight()`. If highlight.js fails to escape a crafted input, or a grammar vulnerability exists, this becomes a direct XSS vector. In Tauri's webview, XSS + the shell capabilities (CRIT-2) = **full remote code execution**.

**Fix**: Replace with `react-syntax-highlighter` or parse highlight.js output into React elements with a strict tag allowlist.

### CRIT-2: Unrestricted Shell Execution via Tauri Capabilities

- **File**: `src-tauri/capabilities/default.json:21-27`
- **Found by**: Backend Expert, Security Expert, AI Expert (all three flagged this independently)
- **CVSS**: 9.1

`claude-stream-sh` maps to `sh` with `"args": true`. Any JavaScript in the webview can run `Command.create("claude-stream-sh", ["-c", "arbitrary command"])`. The `claude` command scope also has `"args": true`, allowing flags like `--dangerously-skip-permissions`.

**Fix**: Replace `"args": true` with regex validators, or (preferred) eliminate `sh -c` entirely by invoking `claude` directly via `Command.create("claude", [...args])`.

### CRIT-3: Only Last User Message Sent to Claude CLI

- **File**: `src/lib/claude-adapter.ts:640-650`
- **Found by**: AI Expert, Backend Expert

`extractUserPrompt()` discards all messages except the last user message. When `--resume` fails and a fresh session starts, all prior conversation context is silently lost. The user receives no warning.

**Fix**: Display a toast/notification when session continuity breaks. Consider sending a conversation summary as a system prompt for fresh sessions.

### CRIT-4: No Regenerate/Reload Action

- **File**: `src/components/assistant-ui/thread.tsx:834-876`
- **Found by**: AI Expert

`ActionBarPrimitive.Reload` is absent. Users cannot retry a failed or unsatisfactory response -- they must retype the prompt. This is a fundamental UX gap for a chat application.

**Fix**: Add `ActionBarPrimitive.Reload` to the assistant action bar. Implement by clearing the session and resending the last prompt.

---

## High Severity Issues

### HIGH-1: Sidebar Completely Hidden on Screens < 1024px

- **File**: `src/App.css:449-464`
- **Found by**: Frontend Expert

Below 1024px, both `.workspace-nav` and `.workspace-utility` get `display: none` with no fallback -- no hamburger menu, drawer, or slide-over. Users lose access to thread navigation entirely.

**Fix**: Implement a Sheet/Drawer triggered by a hamburger button for mobile-width windows. Add an intermediate breakpoint at 768px.

### HIGH-2: Panel Toggle Buttons Have No Effect on Mobile

- **File**: `src/components/ThreadWorkspace.tsx:40-60`
- **Found by**: Frontend Expert

Panel toggle buttons render and are clickable, but the CSS `display: none` media query overrides React state, making the buttons non-functional below 1024px.

**Fix**: Coordinate responsive behavior via `useMediaQuery` in JavaScript, rendering a drawer/sheet on small screens.

### HIGH-3: Missing ARIA Labels and Keyboard Navigation

- **Files**: `src/components/assistant-ui/thread-list.tsx` (multiple lines)
- **Found by**: Frontend Expert

Thread action buttons lack `aria-label`. The thread list has no `role="list"`, no `aria-selected`, no arrow-key navigation. `ThreadListPrimitive` sub-items are bypassed in favor of custom rendering, losing built-in accessibility.

**Fix**: Add ARIA attributes, implement keyboard navigation, or leverage `ThreadListPrimitive.Item*` sub-primitives.

### HIGH-4: Notes Textarea Has No Persistence

- **File**: `src/components/ThreadWorkspace.tsx:79-82`
- **Found by**: Frontend Expert

The utility panel `<textarea>` has no `onChange`, no state, no persistence. All text is lost on re-render.

**Fix**: Wire to `useState` + localStorage or SQLite persistence.

### HIGH-5: Unrestricted SQL Access from Webview

- **File**: `src-tauri/capabilities/default.json:11-12`
- **Found by**: Security Expert
- **CVSS**: 7.5

`sql:allow-execute` lets the webview run arbitrary SQL including DDL. Combined with XSS, this means full database access.

**Fix**: Move write operations to Rust-side Tauri commands with validation.

### HIGH-6: 30 highlight.js Grammars Loaded Eagerly

- **File**: `src/components/assistant-ui/claude-tool-display.tsx:15-48`
- **Found by**: Security Expert

All 30 language grammars are bundled and registered at module load (~200-400KB uncompressed). `highlightAuto()` tests all 30 languages for every text chunk.

**Fix**: Lazy-load grammars on demand. Limit `highlightAuto` to 5-8 common languages.

### HIGH-7: ThreadList Re-renders Entirely on Any State Change

- **File**: `src/components/assistant-ui/thread-list.tsx` (1018 lines, 20+ state variables)
- **Found by**: Frontend Expert, Security Expert

Every keystroke in any input re-renders the entire thread list -- all workspaces, threads, tooltips, and action buttons.

**Fix**: Extract `WorkspaceSection` and `ThreadRow` as `React.memo` components. Move CRUD state to Zustand (already installed).

---

## Medium Severity Issues

| # | Issue | File | Found by |
|---|-------|------|----------|
| M1 | Dark-only design with dead `dark:` variant classes | `App.css:7`, `themes.ts` | Frontend |
| M2 | Hardcoded 240px sidebar widths squeeze content | `App.css:110-126` | Frontend |
| M3 | Touch targets below 44x44px standard | Multiple components | Frontend |
| M4 | Missing loading states for async operations | `thread-list.tsx` | Frontend |
| M5 | Single-thread deletion has no confirmation dialog | `thread-list.tsx:739` | Frontend |
| M6 | Error messages displayed as small inline text | `thread-list.tsx:541` | Frontend |
| M7 | Permission approval bar may consume excessive space | `thread.tsx:401-441` | Frontend |
| M8 | `overflow-x-auto` on thread viewport enables unwanted horizontal scroll | `thread.tsx:110` | Frontend |
| M9 | Native `<select>` and `<input>` used instead of shadcn components | Multiple files | Frontend |
| M10 | External fonts loaded from Google CDN (fails offline) | `App.css:1` | Frontend |
| M11 | Z-index conflicts (DevPanel and Dialog both at z-50) | Multiple | Frontend |
| M12 | Sidebar collapse animation janky (grid + width transition) | `App.css:128-179` | Frontend |
| M13 | Markdown table uses `overflow-y-auto` instead of `overflow-x-auto` | `markdown-text.tsx:176` | Frontend |
| M14 | Shell command env var pattern correct but fragile | `claude-adapter.ts:1244-1269` | Security |
| M15 | Session IDs stored in plaintext SQLite | `db.ts:491-521` | Security |
| M16 | Raw CLI events archived unconditionally (unbounded DB growth) | `claude-adapter.ts:526-534` | Security, Performance |
| M17 | N+1 query pattern for thread metadata loading | `thread-list.tsx:216-258` | Performance |
| M18 | No syntax highlighting in markdown code blocks (inconsistency) | `markdown-text.tsx:218-239` | AI Expert |
| M19 | No cleanup of session state on thread deletion | `claude-adapter.ts:155-158` | AI Expert |

### M1: Dark-Only Design with Dead `dark:` Variant Classes

- **Files**: `src/App.css:7,49`, `src/lib/themes.ts:1`
- **Severity**: Medium

The CSS defines `color-scheme: dark` and `@custom-variant dark (&:is(.dark *))`, but the `.dark` class is never toggled. Components using `dark:` prefixed classes have dead code. The `ThemeSwitcher` renders `null`. Only one theme ("carbon", dark) exists.

**Fix**: Either fully commit to dark-only (remove `dark:` variants) or implement a proper theme toggle.

### M2: Hardcoded 240px Sidebar Widths

- **File**: `src/App.css:110-126`
- **Severity**: Medium

`.workspace-grid` uses `grid-template-columns: 240px minmax(0, 1fr) 240px`. On 800px-wide windows, the chat area gets only ~320px.

**Fix**: Use `clamp(180px, 20vw, 280px)` or add an intermediate breakpoint.

### M3: Touch Targets Below 44x44px

- **Files**: `tooltip-icon-button.tsx:28`, `thread-list.tsx` (multiple), `ThreadWorkspace.tsx`
- **Severity**: Medium

Many buttons use `size-6` (24x24px) or `size-7` (28x28px), below the 44x44px accessibility recommendation.

**Fix**: Increase to `size-8` (32px) minimum or add hit area padding.

### M4: Missing Loading States

- **Files**: `thread-list.tsx`, `thread.tsx`
- **Severity**: Medium

Thread metadata loading, branch switching, workspace deletion, and thread rename have no visual loading indicators.

**Fix**: Add spinners/skeleton states mirroring the workspace creation pattern which already works correctly.

### M5: No Confirmation for Single-Thread Deletion

- **File**: `src/components/assistant-ui/thread-list.tsx:739`
- **Severity**: Medium

Deleting a thread is one-click with no confirmation. Workspace deletion has a dialog. Inconsistent and risky.

**Fix**: Add confirmation step or implement undo/toast pattern.

### M6: Error Messages Easy to Miss

- **File**: `src/components/assistant-ui/thread-list.tsx:541`
- **Severity**: Medium

Errors shown as `<p className="px-1 text-destructive text-xs">` -- small, red inline text.

**Fix**: Use shadcn's Sonner/Toast for transient errors.

### M7: Permission Approval Bar Space Issue

- **File**: `src/components/assistant-ui/thread.tsx:401-441`
- **Severity**: Medium

On narrow viewports, the approval bar + composer can consume excessive vertical space.

**Fix**: Make the approval bar a floating overlay or limit its height further.

### M8: Thread Viewport Horizontal Scroll

- **File**: `src/components/assistant-ui/thread.tsx:110`
- **Severity**: Medium

`overflow-x-auto` on the viewport means wide content triggers a horizontal scrollbar on the entire thread.

**Fix**: Change to `overflow-x-hidden`. Individual code blocks already handle their own overflow.

### M9: Native Form Controls Instead of shadcn

- **Files**: `thread-list.tsx` (6 raw `<input>` elements), `thread.tsx` (native `<select>`)
- **Severity**: Medium

Violates the project's stated component philosophy: "Always use shadcn/ui or Radix primitives."

**Fix**: Replace with shadcn's `Input`, `Select`, and `Textarea` components.

### M10: External Font CDN (Offline Failure)

- **File**: `src/App.css:1`
- **Severity**: Medium

`@import url("https://fonts.googleapis.com/css2?...")` is render-blocking and fails offline. Critical for a desktop app.

**Fix**: Bundle woff2 font files locally with `@font-face` declarations.

### M11: Z-Index Conflicts

- **Files**: `DevPanel.tsx` (z-50), `dialog.tsx` (z-50), `tooltip.tsx` (z-50)
- **Severity**: Medium

DevPanel at z-50 competes with Dialog overlays at z-50. Opening a dialog while DevPanel is open causes unpredictable stacking.

**Fix**: Define a z-index scale as CSS custom properties (`--z-panel: 40`, `--z-overlay: 50`, `--z-tooltip: 60`).

### M12: Janky Sidebar Collapse Animation

- **File**: `src/App.css:128-179`
- **Severity**: Medium

Transitioning panel `width` and `grid-template-columns` simultaneously causes layout thrashing. CSS Grid columns aren't natively animatable.

**Fix**: Use `transform: translateX` for slide-in/out or animate panels independently of the grid.

### M13: Markdown Table Overflow Direction

- **File**: `src/components/assistant-ui/markdown-text.tsx:176`
- **Severity**: Medium

Tables use `overflow-y-auto` but typically overflow horizontally.

**Fix**: Change to `overflow-x-auto`. Wrap in `<div className="overflow-x-auto">`.

### M14: Shell Env Var Pattern -- Correct but Fragile

- **File**: `src/lib/claude-adapter.ts:1244-1269`
- **Severity**: Medium
- **CVSS**: 4.3

User input passed via env vars with double-quoted `$CLAUDE_PROMPT` in shell script. Safe as written, but one removed quote from injection. Same pattern used for git operations in `workspace-repo-metadata.ts`.

**Fix**: Migrate to direct `Command.create("claude", [...args])` and `Command.create("git", [...args])`.

### M15: Session IDs in Plaintext SQLite

- **File**: `src/lib/db.ts:491-521`
- **Severity**: Medium
- **CVSS**: 4.0

Claude CLI session IDs stored unencrypted. Local processes can steal and resume sessions.

**Fix**: Use OS keychain via `tauri-plugin-stronghold` or ensure restrictive file permissions (600).

### M16: Unbounded Dev Event Archival

- **File**: `src/lib/claude-adapter.ts:526-534`, `src/lib/dev-event-batcher.ts`
- **Severity**: Medium

Every stream event archived to SQLite unconditionally, even in production. No automatic pruning. Database grows unboundedly.

**Fix**: Gate archival on `import.meta.env.DEV` or add TTL-based automatic pruning.

### M17: N+1 Query Pattern for Thread Metadata

- **File**: `src/components/assistant-ui/thread-list.tsx:216-258`
- **Severity**: Medium

For N threads: 2N SQL queries + N shell processes for workspace metadata. With 20 threads and 5 workspaces: 40 queries + 5 shell spawns per sidebar render.

**Fix**: Add batch queries (`WHERE id IN (...)`) and cache workspace metadata with 30-60s TTL.

### M18: No Syntax Highlighting in Markdown Code Blocks

- **File**: `src/components/assistant-ui/markdown-text.tsx:218-239`
- **Severity**: Medium

`highlight.js` is registered in `claude-tool-display.tsx` but NOT used in the markdown renderer. Code blocks in assistant text have no highlighting, while tool call panels do.

**Fix**: Integrate highlight.js into the markdown `code` component.

### M19: No Session Cleanup on Thread Deletion

- **File**: `src/lib/claude-adapter.ts:155-158, 166`
- **Severity**: Medium

Thread deletion does not clean up `sessionByThread`, `activeChildByThread`, `cwdByThread`, `gitBranchByThread`, etc. Running processes continue. References retained until app restart.

**Fix**: Add a cleanup function called on thread deletion that kills child processes and removes map entries.

---

## Low Severity Issues

| # | Issue | File | Found by |
|---|-------|------|----------|
| L1 | Unused `greet` Tauri command (dead code) | `src-tauri/src/lib.rs:4` | Backend, AI |
| L2 | `ThemeSwitcher` renders `null` (stub) | `src/components/ThemeSwitcher.tsx` | Frontend, AI |
| L3 | `VisualDesigner` renders `null` (stub) | `src/components/VisualDesigner.tsx` | Frontend, AI |
| L4 | No thread rename `maxLength` | `thread-list.tsx:685-700` | Frontend |
| L5 | `AssistantMessageMetrics` always renders `null` (metadata never populated) | `thread.tsx:810-832` | AI |
| L6 | Permission approval system is a non-functional stub | `claude-adapter.ts:307-324` | AI |
| L7 | `wasm-unsafe-eval` in CSP with no WASM usage | `tauri.conf.json:21` | Backend |
| L8 | Page title still "Tauri + React + Typescript" | `index.html:7` | Frontend |
| L9 | Unused Avatar component installed | `src/components/ui/avatar.tsx` | Frontend |
| L10 | Inconsistent font size units (rem, px, arbitrary Tailwind) | `App.css`, multiple components | Frontend |
| L11 | `h-screen w-screen` may cause issues on mobile WebViews | `App.tsx:12` | Frontend |
| L12 | DevPanel has no mobile responsiveness | `DevPanel.tsx:202` | Frontend |
| L13 | Empty state messages lack visual emphasis | `thread-list.tsx:747-761` | Frontend |
| L14 | Workspace creation error shown in disruptive Dialog | `thread-list.tsx:911-926` | Frontend |
| L15 | Scroll-to-bottom button z-index may be obscured | `thread.tsx:152` | Frontend |
| L16 | `!important` overrides in highlight.js CSS | `App.css:369-388` | Frontend |
| L17 | Inconsistent CSS custom properties vs Tailwind utilities | `App.css` workspace classes | Frontend |
| L18 | CSS class coupling with assistant-ui internals | `App.css:209-266` | Frontend |
| L19 | Scrollbar styling only on thread viewport | `App.css:274-277` | Frontend |
| L20 | `child.kill()` errors silently swallowed | `claude-adapter.ts:1314,1317` | Backend |
| L21 | Dependency version pinning too broad | `package.json`, `Cargo.toml` | Backend, Security |
| L22 | No window-close process cleanup (zombie processes) | `claude-adapter.ts` | Backend |

---

## Positive Findings

The auditors noted several strong patterns in the codebase:

| Area | Finding |
|------|---------|
| **Architecture** | `useRemoteThreadListRuntime` + SQLite replaces the old runtime destruction pattern -- major improvement |
| **Stream processing** | Accumulator-based pipeline with scoped indexing handles nested tool calls correctly |
| **Tool display** | Custom per-tool renderers (Read, Edit, Bash, etc.) with syntax highlighting and truncation are excellent |
| **Safety** | No `unsafe` Rust code. Parameterized SQL queries prevent injection. Env vars prevent shell injection |
| **Dev tooling** | Circular buffer + batch archival + DevPanel provide good stream observability |
| **Abort handling** | `AbortSignal` correctly wired to `child.kill()` with pre-aborted signal check |
| **Line buffering** | NDJSON stream parser correctly handles partial lines with trailing buffer flush |
| **Thread locking** | FIFO waiter queue with timeout prevents concurrent CLI invocations per thread |
| **HMR cleanup** | Child processes properly killed on hot reload |
| **SQLite setup** | WAL mode enabled for concurrent read/write. Proper foreign keys, indexes, and migration sequencing |

---

## Frontend UI/UX Detailed Findings

### Responsive Design & Mobile

The app has a single breakpoint at 1024px (`App.css:449-464`). Below this width, both sidebars are hidden with `display: none` and no fallback navigation exists. The viewport meta tag is present (`index.html:6`), but the grid layout (`240px | 1fr | 240px`) squeezes content on medium screens.

Key responsive gaps:
- No hamburger menu or drawer for mobile navigation
- Panel toggle buttons render but CSS overrides make them non-functional
- Hardcoded sidebar widths with no fluid sizing
- No intermediate breakpoint for tablets
- Touch targets below accessibility standards (24-28px vs 44px recommended)

### Component Architecture

Two components dominate the codebase:
- `thread-list.tsx` (1018 lines, 20+ state variables) -- workspace/thread CRUD, grouping, rename, delete, 3 dialog modals
- `thread.tsx` (892 lines) -- thread, composer, messages, action bars, permission bar, workspace picker

Both violate separation of concerns and would benefit from decomposition into sub-components and custom hooks.

Native HTML elements (`<select>`, `<input>`, `<textarea>`) are used in multiple places instead of shadcn/ui equivalents, violating the project's stated component philosophy.

### CSS & Styling

- External font CDN loading will fail offline
- Z-index conflicts between DevPanel (z-50) and Dialog (z-50)
- Dead `dark:` variant classes (dark-only design, no toggle)
- `!important` overrides for highlight.js
- Tight coupling with assistant-ui internal class names (`.aui-*`)
- Sidebar collapse animation suffers from grid + width transition conflicts
- Inconsistent font size units across components

---

## Backend Rust/Tauri Detailed Findings

### Rust Backend

The Rust layer is minimal (two source files, ~50 lines of application code). It serves as a plugin registration harness with SQLite migrations. No `unsafe` code exists. The only custom command (`greet`) is unused dead code.

### Tauri Configuration

- **CSP**: Reasonably tight (`script-src 'self'`, no `unsafe-eval`). `unsafe-inline` for styles is necessary for Tailwind. `wasm-unsafe-eval` is unnecessary (no WASM).
- **Window**: No `minWidth`/`minHeight` constraints. No `resizable` configuration.
- **Bundle**: `"targets": "all"` builds for every platform format unnecessarily.

### Capabilities (Security-Critical)

The `capabilities/default.json` is the single most important security concern:
- `claude-stream-sh` (maps to `sh`) with `"args": true` -- **arbitrary shell execution**
- `claude` with `"args": true` -- **unrestricted CLI flags**
- `shell:allow-stdin-write` and `shell:allow-kill` -- **globally scoped** (not per-command)
- `sql:allow-execute` -- **arbitrary SQL from webview**

### CLI Integration

The `sh -c` invocation pattern uses environment variables for user input (safe against injection as written), but the shell layer itself is unnecessary and adds attack surface. Git operations in `workspace-repo-metadata.ts` also go through `sh -c` with properly quoted positional args.

### Process Lifecycle

- No window-close cleanup -- zombie processes possible in production
- `child.kill()` errors silently swallowed
- Thread lock timeout holds lock until current run completes (hung CLI blocks thread)

### Migrations

Four migrations properly sequenced. Migration 003 duplicates table creation from 001 (idempotent via `IF NOT EXISTS`). No down migrations exist.

---

## Security & Performance Detailed Findings

### Security Summary

| ID | Category | Severity | CVSS | Issue |
|---|---|---|---|---|
| SEC-01 | XSS | Critical | 8.1 | `dangerouslySetInnerHTML` with highlight.js output from untrusted tool results |
| SEC-02 | Shell Security | Critical | 9.1 | `sh` with `"args": true` allows arbitrary command execution from webview |
| SEC-03 | Command Injection | Medium | 4.3 | Shell scripts with env vars -- correct but fragile pattern |
| SEC-04 | IPC Security | High | 7.5 | Unrestricted SQL access from webview via `sql:allow-execute` |
| SEC-05 | CSP | Low | 2.1 | `unsafe-inline` for styles (necessary for Tailwind) |
| SEC-06 | Data Security | Medium | 4.0 | Session IDs stored in plaintext SQLite |
| SEC-07 | Data Security | Medium | 3.5 | Raw CLI events archived unconditionally |
| SEC-08 | Attack Surface | Low | 1.0 | Unused `greet` command exposed to webview |
| SEC-09 | Supply Chain | Low | 2.0 | Dependencies use caret ranges, not pinned |
| SEC-10 | Access Control | Low | 2.5 | Directory browser allows selecting any filesystem path |

**Critical attack chain**: XSS (SEC-01) -> Shell execution (SEC-02) = full remote code execution. A crafted file in a repository being analyzed could trigger this chain.

### Performance Summary

| ID | Category | Severity | Issue |
|---|---|---|---|
| PERF-01 | Bundle Size | High | 30 highlight.js grammars loaded eagerly (~200-400KB) |
| PERF-02 | Rendering | Medium | No virtual scrolling for messages or dev events (up to 500 DOM nodes) |
| PERF-03 | Database | Medium | N+1 queries for thread metadata (2N queries + N shell spawns) |
| PERF-04 | Process Mgmt | Medium | Shell process per workspace for git metadata, no caching |
| PERF-05 | Database | Medium | Dev events archived to SQLite unconditionally in production |
| PERF-06 | Database | Low | Dynamic SQL construction for batch inserts |
| PERF-07 | Memory | Low | String concatenation in hot stream processing path |
| PERF-08 | CPU | Low | Content array rebuilt from scratch on every yield (~60fps) |
| PERF-09 | Concurrency | Low | Thread lock waiter queue under CLI hang conditions |
| PERF-10 | Rendering | High | ThreadList 1000-line component re-renders on any state change |
| PERF-11 | Memory | Low | Snapshot array allocation on every stream event |

---

## AI Integration Detailed Findings

### assistant-ui Integration Quality

**Correct usage**: `ThreadPrimitive`, `MessagePrimitive`, `ComposerPrimitive`, `ActionBarPrimitive`, `AuiIf` all used correctly and idiomatically.

**Major improvement**: The old `key={activeThread.id}` runtime destruction pattern has been replaced with `useRemoteThreadListRuntime` + `SQLiteThreadListAdapter` + `SQLiteHistoryProvider`. Thread switching no longer destroys the runtime.

**Bypassed primitives**: `ThreadListPrimitive.Item*` sub-primitives are not used -- the thread list is entirely custom-rendered, losing built-in keyboard navigation and selection management.

### ChatModelAdapter Implementation

The `run()` method correctly implements `ChatModelAdapter` as an async generator with:
- Proper `AbortSignal` handling
- Frame-rate throttled yielding (16ms / ~60fps)
- Accumulator-based content building
- Scoped tool call indexing for nested tool calls
- Three-tier retry (resume -> session-id -> fresh)

**Critical gap**: Only the last user message is extracted and sent. Session continuity depends entirely on `--resume`.

### Missing assistant-ui Features

| Feature | Status | Impact |
|---------|--------|--------|
| `AttachmentAdapter` | Not configured | Cannot attach files to prompts |
| `SpeechAdapter` | Not configured | No voice input |
| `FeedbackAdapter` | Not configured | No thumbs up/down on messages |
| `ActionBarPrimitive.Reload` | Not rendered | Cannot regenerate responses |
| `ActionBarPrimitive.Edit` | Not rendered | Cannot edit sent messages |
| `MessagePrimitive.BranchPicker` | Not rendered | No conversation branching |
| `ThreadPrimitive.Suggestion` | Not rendered | No suggested prompts |
| `ComposerPrimitive.Attachments` | Not rendered | No attachment UI |
| `ThreadListPrimitive.Item*` | Bypassed | Loses built-in keyboard nav |

### Tool Call Rendering

Excellent implementation. Custom renderers for 9 Claude Code tools (Read, Edit, Write, Bash, Grep, Glob, WebSearch, WebFetch, Task) with:
- Syntax highlighting (via highlight.js)
- File path and language detection
- Pseudo-diff display for Edit tool
- Exit code display for Bash
- Truncation with expand/collapse
- Shared `ToolFrame` wrapper using `ToolFallback` compound component

### Thinking/Reasoning Blocks

Correctly mapped from Claude CLI's `thinking` type to assistant-ui's `reasoning` content type. Rendered in collapsible `<details>` elements via `ReasoningGroup` and `ReasoningPart` components.

### Completeness as a Claude CLI Frontend

| Capability | Status |
|-----------|--------|
| Send prompts | Working |
| Stream responses | Working |
| Tool call display | Excellent |
| Thinking/reasoning display | Working |
| Session persistence | Working (SQLite) |
| Session resume | Working |
| Thread management | Working (with workspace grouping) |
| Message history | Working (SQLite) |
| Cancel generation | Working |
| File attachments | Not implemented |
| Model selection | Display only |
| Permission approval | Scaffolded but non-functional (stub) |
| MCP server status | Display only (DevPanel) |
| Slash commands | Not exposed in UI |
| System prompt configuration | Not exposed |
| Context compaction awareness | Not implemented |

---

## Priority Remediation Roadmap

### P0 -- Immediate (before any release)

1. Fix **CRIT-1** (XSS via dangerouslySetInnerHTML)
2. Fix **CRIT-2** (restrict shell capabilities or eliminate `sh -c`)

### P1 -- Short-term

3. Fix **CRIT-4** (add regenerate/reload action)
4. Fix **HIGH-1/HIGH-2** (mobile-responsive navigation with Sheet/Drawer)
5. Fix **HIGH-5** (move DB ops to Rust commands)
6. Fix **HIGH-6** (lazy-load highlight.js grammars)
7. Fix **HIGH-7** (memoize ThreadList sub-components)

### P2 -- Medium-term

8. Fix **CRIT-3** (stale session notification)
9. Fix **HIGH-3** (accessibility/ARIA)
10. Fix **M9** (replace native form controls with shadcn)
11. Fix **M10** (bundle fonts locally for offline operation)
12. Fix **M16/M17** (gate dev event archival, batch DB queries)
13. Fix **M18** (syntax highlighting in markdown code blocks)

### P3 -- Enhancement

14. Implement attachment adapter (Claude CLI `-f` flag)
15. Implement model selection dropdown
16. Wire permission approval system to Claude CLI hooks
17. Add thread search/filter
18. Clean up dead code (ThemeSwitcher, VisualDesigner, greet command, Avatar)
19. Update CLAUDE.md to reflect current architecture (runtime destruction is fixed)

---

## Appendix: Files Reviewed

All source files were reviewed across all four audits:

**Frontend (src/components/)**: `App.tsx`, `ThreadWorkspace.tsx`, `DevPanel.tsx`, `ThemeSwitcher.tsx`, `VisualDesigner.tsx`, `assistant-ui/thread.tsx`, `assistant-ui/thread-list.tsx`, `assistant-ui/markdown-text.tsx`, `assistant-ui/claude-tool-display.tsx`, `assistant-ui/tool-fallback.tsx`, `assistant-ui/tooltip-icon-button.tsx`, `RuntimeProvider.tsx`, `ui/button.tsx`, `ui/dialog.tsx`, `ui/tooltip.tsx`, `ui/avatar.tsx`, `ui/collapsible.tsx`

**Core Logic (src/lib/)**: `claude-adapter.ts`, `sqlite-thread-list-adapter.ts`, `sqlite-thread-history-adapter.tsx`, `db.ts`, `dev-event-batcher.ts`, `workspace-repo-metadata.ts`, `visual-layouts.ts`, `visual-layout-context.tsx`, `themes.ts`, `utils.ts`

**Backend (src-tauri/)**: `src/lib.rs`, `src/main.rs`, `build.rs`, `Cargo.toml`, `tauri.conf.json`, `capabilities/default.json`, `migrations/001-004`

**Config**: `package.json`, `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`, `vite.config.ts`, `components.json`, `index.html`, `App.css`
