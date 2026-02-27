# Plan: Competitive Features — Closing the Gap

**Date**: 2026-02-18
**Status**: Proposed
**Related**: `claudedocs/research_competitive_analysis_2026-02-18.md`, `docs/enhanced-cli-integration-plan.md`

---

## Context

A competitive analysis of Conductor, OpenAI Codex App, OpenCode, and Kilo Code identified critical feature gaps in Pluribus. Every competitor ships git integration, integrated terminals, worktree isolation, and extensibility (MCP/skills). Pluribus has strong foundations — SQLite persistence, streaming analytics, session management, 5 themes — but lacks the features that developers expect from a desktop coding agent.

This plan covers the **6 highest-impact features** organized into 4 phases, ordered by dependency chain and effort.

### Principles

- **Leverage existing infrastructure.** Pluribus already has git metadata functions (`workspace-repo-metadata.ts`), a 3-column layout with an unused right panel, and the Tauri shell plugin. Build on these.
- **assistant-ui first.** Check if assistant-ui provides primitives before building custom (per CLAUDE.md component philosophy).
- **Incremental.** Each phase delivers a usable feature. No big-bang releases.
- **Claude CLI is the agent.** We wrap it, not replace it. Features that Claude CLI already handles (MCP, skills, slash commands) should be surfaced in the UI, not reimplemented.

---

## Phase 1: Integrated Terminal

**Why first:** Every competitor has this. Users can't validate AI changes, run tests, or debug without leaving the app. This is the single most impactful missing feature.

**Approach:** Embed [xterm.js](https://xtermjs.org/) with a Tauri shell PTY backend. Each workspace gets a persistent terminal session. The terminal lives in the right panel (currently the scratchpad stub), reusing the existing toggle infrastructure.

### Dependencies to add

```bash
bun add @xterm/xterm @xterm/addon-fit @xterm/addon-web-links @xterm/addon-webgl
```

### Tauri side: PTY plugin

Tauri's shell plugin does not support PTY allocation. We need a lightweight Rust command that spawns a PTY and bridges it to the webview via Tauri events.

**`src-tauri/src/pty.rs`** (new):
```rust
use tauri::{command, AppHandle, Manager};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};

#[command]
pub async fn spawn_pty(
    app: AppHandle,
    id: String,
    cwd: String,
    shell: Option<String>,
) -> Result<(), String> {
    // 1. Open PTY with PtySize { rows: 24, cols: 80 }
    // 2. Spawn user's $SHELL (or shell arg) with cwd
    // 3. Spawn read loop: pty stdout → app.emit(&format!("pty:data:{id}"), data)
    // 4. Store pty writer in app state for write commands
}

#[command]
pub fn write_pty(app: AppHandle, id: String, data: String) -> Result<(), String> {
    // Write to stored pty writer
}

#[command]
pub fn resize_pty(app: AppHandle, id: String, rows: u16, cols: u16) -> Result<(), String> {
    // Resize pty
}

#[command]
pub fn kill_pty(app: AppHandle, id: String) -> Result<(), String> {
    // Kill pty process, clean up
}
```

Add `portable-pty` to `src-tauri/Cargo.toml`:
```toml
[dependencies]
portable-pty = "0.8"
```

Register commands in `src-tauri/src/lib.rs`:
```rust
.invoke_handler(tauri::generate_handler![
    pty::spawn_pty, pty::write_pty, pty::resize_pty, pty::kill_pty
])
```

### Frontend: Terminal component

**`src/components/Terminal.tsx`** (new):
```typescript
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface TerminalProps {
  id: string;        // workspace or thread ID
  cwd: string;       // working directory
  visible: boolean;  // controlled by panel toggle
}

export function TerminalPanel({ id, cwd, visible }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!containerRef.current || !visible) return;

    const term = new XTerm({
      fontFamily: "var(--font-mono, monospace)",
      fontSize: 13,
      theme: { /* derive from current Pluribus theme */ },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(containerRef.current);
    fit.fit();

    xtermRef.current = term;
    fitRef.current = fit;

    // Spawn PTY
    invoke("spawn_pty", { id, cwd });

    // PTY → xterm
    const unlisten = listen<string>(`pty:data:${id}`, (event) => {
      term.write(event.payload);
    });

    // xterm → PTY
    term.onData((data) => invoke("write_pty", { id, data }));

    // Resize
    const observer = new ResizeObserver(() => {
      fit.fit();
      invoke("resize_pty", { id, rows: term.rows, cols: term.cols });
    });
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      unlisten.then((fn) => fn());
      invoke("kill_pty", { id });
      term.dispose();
    };
  }, [id, cwd, visible]);

  return <div ref={containerRef} className="h-full w-full" />;
}
```

### Integration into ThreadWorkspace

**Modify `src/components/ThreadWorkspace.tsx`:**

Replace the scratchpad stub in `workspace-utility` with a tab switcher between Scratchpad and Terminal:

```typescript
<aside className="workspace-utility">
  <div className="flex border-b">
    <TabButton active={utilityTab === "terminal"} onClick={() => setUtilityTab("terminal")}>
      <TerminalIcon className="size-4" /> Terminal
    </TabButton>
    <TabButton active={utilityTab === "scratchpad"} onClick={() => setUtilityTab("scratchpad")}>
      <StickyNoteIcon className="size-4" /> Scratchpad
    </TabButton>
  </div>
  {utilityTab === "terminal" && activeWorkspace && (
    <TerminalPanel id={activeWorkspace.id} cwd={activeWorkspace.cwd} visible={utilityOpen} />
  )}
  {utilityTab === "scratchpad" && <ScratchpadStub />}
</aside>
```

### Keyboard shortcut

Add `Cmd+J` / `Ctrl+J` to toggle the utility panel with terminal focused (matching Codex App convention).

### Effort estimate: Medium-High
- Rust PTY backend: ~200 LOC
- Terminal component: ~150 LOC
- Integration + theming: ~100 LOC
- Testing across macOS/Linux/Windows PTY differences

---

## Phase 2: Git Diff & Review Panel

**Why:** Conductor and Codex App both show file changes in a dedicated panel. This is the core review experience that makes AI-generated code trustworthy. Pluribus already tracks tool events (Edit, Write) in the dev panel — we can derive a changes view from this data.

**Approach:** Two-layer approach:
1. **Stream-derived changes:** Parse Edit/Write tool events from the current session to show pending changes in real-time
2. **Git-derived changes:** Run `git diff` / `git status` in the workspace to show actual file system state

### New component: ChangesPanel

**`src/components/ChangesPanel.tsx`** (new):

```typescript
interface FileChange {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
  additions: number;
  deletions: number;
  diff?: string; // unified diff content
}

interface ChangesPanelProps {
  workspaceCwd: string;
  threadId: string;
}

export function ChangesPanel({ workspaceCwd, threadId }: ChangesPanelProps) {
  const [changes, setChanges] = useState<FileChange[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffContent, setDiffContent] = useState<string>("");

  // Poll git status + diff on interval (or after each assistant message completes)
  useEffect(() => {
    const refresh = async () => {
      const status = await getGitStatus(workspaceCwd);
      const diff = await getGitDiff(workspaceCwd);
      setChanges(parseGitStatus(status, diff));
    };
    refresh();
    // Also subscribe to stream events to refresh after tool use
  }, [workspaceCwd, threadId]);

  return (
    <div className="flex h-full flex-col">
      {/* File list with +/- counts */}
      <div className="flex-none border-b px-3 py-2">
        <h3 className="text-sm font-semibold">Changes</h3>
        <span className="text-xs text-muted-foreground">{changes.length} files</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {selectedFile ? (
          <DiffViewer diff={diffContent} filePath={selectedFile} onBack={() => setSelectedFile(null)} />
        ) : (
          <FileChangeList changes={changes} onSelect={setSelectedFile} />
        )}
      </div>
      {/* Action bar */}
      <div className="flex-none border-t px-3 py-2">
        <GitActionBar workspaceCwd={workspaceCwd} changes={changes} />
      </div>
    </div>
  );
}
```

### Git operations module

**`src/lib/git-operations.ts`** (new):

Extend the existing `workspace-repo-metadata.ts` pattern but for mutable git operations:

```typescript
import { Command } from "@tauri-apps/plugin-shell";

// Read operations (extend existing workspace-repo-metadata.ts)
export async function getGitStatus(cwd: string): Promise<string> {
  // git -C <cwd> status --porcelain=v2
}

export async function getGitDiff(cwd: string, staged?: boolean): Promise<string> {
  // git -C <cwd> diff [--cached]
}

export async function getGitFileDiff(cwd: string, path: string): Promise<string> {
  // git -C <cwd> diff -- <path>
}

// Write operations
export async function gitStageFile(cwd: string, path: string): Promise<void> {
  // git -C <cwd> add <path>
}

export async function gitUnstageFile(cwd: string, path: string): Promise<void> {
  // git -C <cwd> restore --staged <path>
}

export async function gitRevertFile(cwd: string, path: string): Promise<void> {
  // git -C <cwd> checkout -- <path>  (with confirmation!)
}

export async function gitCommit(cwd: string, message: string): Promise<string> {
  // git -C <cwd> commit -m <message>
  // Returns commit hash
}

export async function gitPush(cwd: string, remote?: string, branch?: string): Promise<void> {
  // git -C <cwd> push [remote] [branch]
}
```

### DiffViewer component

**`src/components/DiffViewer.tsx`** (new):

Render unified diff output with syntax highlighting. Use the existing code block styling from `markdown-text.tsx` for consistency.

```typescript
export function DiffViewer({ diff, filePath, onBack }: DiffViewerProps) {
  const lines = parseDiff(diff);
  return (
    <div className="font-mono text-xs">
      <div className="sticky top-0 flex items-center gap-2 border-b bg-background px-3 py-1">
        <Button variant="ghost" size="icon-xs" onClick={onBack}>
          <ChevronLeftIcon className="size-3" />
        </Button>
        <span className="truncate">{filePath}</span>
      </div>
      <div className="overflow-x-auto">
        {lines.map((line, i) => (
          <DiffLine key={i} type={line.type} content={line.content} lineNo={line.lineNo} />
        ))}
      </div>
    </div>
  );
}

function DiffLine({ type, content, lineNo }: { type: "add" | "remove" | "context"; content: string; lineNo?: number }) {
  const bg = type === "add" ? "bg-green-500/10" : type === "remove" ? "bg-red-500/10" : "";
  const prefix = type === "add" ? "+" : type === "remove" ? "-" : " ";
  return (
    <div className={cn("flex px-3 py-px", bg)}>
      <span className="w-10 text-right text-muted-foreground select-none">{lineNo ?? ""}</span>
      <span className="w-4 text-center select-none">{prefix}</span>
      <span className="flex-1 whitespace-pre">{content}</span>
    </div>
  );
}
```

### GitActionBar component

**`src/components/GitActionBar.tsx`** (new):

Quick actions for the changes panel:

```typescript
export function GitActionBar({ workspaceCwd, changes }: GitActionBarProps) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="xs" onClick={() => stageAll(workspaceCwd)}>
        Stage All
      </Button>
      <Button variant="outline" size="xs" onClick={() => revertAll(workspaceCwd)}>
        Revert All
      </Button>
      <CommitDialog workspaceCwd={workspaceCwd} stagedCount={countStaged(changes)} />
    </div>
  );
}
```

### Integration into layout

Add "Changes" as a third tab in the utility panel (alongside Terminal and Scratchpad):

```typescript
<TabButton active={utilityTab === "changes"} onClick={() => setUtilityTab("changes")}>
  <GitBranchIcon className="size-4" /> Changes
  {changeCount > 0 && <Badge variant="secondary">{changeCount}</Badge>}
</TabButton>
```

### Auto-refresh strategy

Subscribe to the dev event stream. When an `Edit`, `Write`, or `Bash` tool event completes, trigger a git status refresh:

```typescript
// In ChangesPanel, subscribe to dev events
useEffect(() => {
  return subscribeClaudeDevEvents((event) => {
    if (["Edit", "Write", "Bash"].includes(event.toolName)) {
      refreshGitStatus();
    }
  });
}, []);
```

### Effort estimate: Medium
- Git operations module: ~150 LOC
- ChangesPanel + FileChangeList: ~200 LOC
- DiffViewer: ~150 LOC
- GitActionBar + CommitDialog: ~100 LOC
- Integration + auto-refresh: ~50 LOC

---

## Phase 3: File @Mentions & Command Palette

Two related features that enhance the composer and navigation.

### 3A: File @Mentions in Composer

**Why:** Codex App's `@` file mention is a killer UX — users can reference project files without leaving the chat. Currently Pluribus sends only the last user message to Claude CLI; adding file paths as context improves prompt quality.

**Approach:** Intercept `@` keystrokes in the composer, show a fuzzy file search popover, and insert the selected file path into the prompt text.

#### File listing module

**`src/lib/file-listing.ts`** (new):

```typescript
import { Command } from "@tauri-apps/plugin-shell";

export interface FileEntry {
  path: string;       // relative to workspace root
  isDirectory: boolean;
  depth: number;
}

export async function listWorkspaceFiles(cwd: string): Promise<FileEntry[]> {
  // Use git ls-files for tracked files (fast, respects .gitignore)
  // Falls back to find for non-git directories
  // git -C <cwd> ls-files --full-name
  // Cache result per workspace, invalidate on tool events
}

export function fuzzyMatch(query: string, files: FileEntry[]): FileEntry[] {
  // Simple fuzzy matching: split query into chars, match in order
  // Score by: consecutive matches, path depth, filename vs directory match
}
```

#### MentionPopover component

**`src/components/MentionPopover.tsx`** (new):

```typescript
export function MentionPopover({
  query, files, onSelect, onDismiss, position
}: MentionPopoverProps) {
  const filtered = useMemo(() => fuzzyMatch(query, files), [query, files]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Arrow keys to navigate, Enter to select, Escape to dismiss
  return (
    <div
      className="absolute z-50 max-h-48 w-80 overflow-y-auto rounded-lg border bg-popover shadow-lg"
      style={{ bottom: position.bottom, left: position.left }}
    >
      {filtered.slice(0, 10).map((file, i) => (
        <button
          key={file.path}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm",
            i === selectedIndex && "bg-accent"
          )}
          onClick={() => onSelect(file)}
        >
          {file.isDirectory ? <FolderIcon className="size-3" /> : <FileIcon className="size-3" />}
          <span className="truncate font-mono text-xs">{file.path}</span>
        </button>
      ))}
    </div>
  );
}
```

#### Composer integration

**Modify `src/components/assistant-ui/thread.tsx` (Composer):**

Wrap `ComposerPrimitive.Input` with `@` detection logic. When the user types `@`, capture the subsequent characters as a search query and display the popover. On selection, insert the file path.

```typescript
function Composer() {
  const [mentionState, setMentionState] = useState<{
    active: boolean;
    query: string;
    position: { bottom: number; left: number };
  }>({ active: false, query: "", position: { bottom: 0, left: 0 } });

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Detect @ trigger, arrow key navigation, Enter to select, Escape to dismiss
  };

  return (
    <ComposerPrimitive.Root>
      <div className="relative flex w-full flex-col rounded-2xl border bg-background px-1 pt-2">
        <ComposerPrimitive.Input
          placeholder="Send a message... (@ to mention files)"
          onKeyDown={handleKeyDown}
          // ...existing props
        />
        {mentionState.active && (
          <MentionPopover
            query={mentionState.query}
            files={workspaceFiles}
            onSelect={insertMention}
            onDismiss={() => setMentionState({ ...mentionState, active: false })}
            position={mentionState.position}
          />
        )}
        <ComposerAction />
      </div>
    </ComposerPrimitive.Root>
  );
}
```

**Note:** assistant-ui's `ComposerPrimitive.Input` may not expose fine-grained event control. If it doesn't, we may need a custom textarea that forwards the final value to the runtime. Check `ComposerPrimitive` docs first.

### 3B: Command Palette (Cmd+K)

**Why:** Codex App has Cmd+K. It's a standard desktop app pattern that makes all features discoverable.

**Approach:** Use [cmdk](https://cmdk.paco.me/) (already a common shadcn dependency) to build a command palette triggered by Cmd+K.

#### Dependency

```bash
bun add cmdk
```

#### CommandPalette component

**`src/components/CommandPalette.tsx`** (new):

```typescript
import { Command } from "cmdk";

export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <Command.Dialog open={open} onOpenChange={setOpen} label="Command palette">
      <Command.Input placeholder="Type a command or search..." />
      <Command.List>
        <Command.Group heading="Navigation">
          <Command.Item onSelect={() => { /* new thread */ }}>New Thread</Command.Item>
          <Command.Item onSelect={() => { /* toggle terminal */ }}>Toggle Terminal</Command.Item>
          <Command.Item onSelect={() => { /* toggle changes */ }}>Toggle Changes</Command.Item>
          <Command.Item onSelect={() => { /* toggle sidebar */ }}>Toggle Sidebar</Command.Item>
        </Command.Group>
        <Command.Group heading="Git">
          <Command.Item>Commit Changes...</Command.Item>
          <Command.Item>Switch Branch...</Command.Item>
          <Command.Item>Create Branch...</Command.Item>
        </Command.Group>
        <Command.Group heading="Workspace">
          <Command.Item>New Workspace...</Command.Item>
          <Command.Item>Switch Workspace...</Command.Item>
        </Command.Group>
        <Command.Group heading="Settings">
          <Command.Item>Change Theme...</Command.Item>
          <Command.Item>Toggle Dev Panel</Command.Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}
```

#### Integration

Add `<CommandPalette />` to the root layout in `ThreadWorkspace.tsx` or `App.tsx`.

### Effort estimate: Medium
- File listing + fuzzy match: ~100 LOC
- MentionPopover: ~120 LOC
- Composer integration: ~80 LOC
- CommandPalette: ~150 LOC

---

## Phase 4: Worktree Isolation & Parallel Agents

**Why:** This is the core feature of both Conductor and Codex App. Without worktree isolation, parallel AI agents risk conflicting changes on the same files. This phase depends on Phase 1 (terminal) and Phase 2 (git operations).

**Approach:** When a user creates a new thread in a workspace, offer a choice between "Local" (work in the main checkout) and "Worktree" (create an isolated git worktree). Each worktree thread gets its own CWD, terminal, and Claude CLI session.

### Worktree management module

**`src/lib/git-worktree.ts`** (new):

```typescript
import { Command } from "@tauri-apps/plugin-shell";

export interface Worktree {
  path: string;       // absolute path to worktree directory
  branch: string;     // branch checked out in worktree
  commitHash: string; // HEAD commit
  isMain: boolean;    // true if this is the main checkout
}

export async function listWorktrees(repoRoot: string): Promise<Worktree[]> {
  // git -C <repoRoot> worktree list --porcelain
  // Parse output into Worktree[]
}

export async function createWorktree(
  repoRoot: string,
  branchName: string,
  baseBranch?: string,
): Promise<Worktree> {
  // Determine worktree path: <repoRoot>/../.pluribus-worktrees/<branchName>
  // git -C <repoRoot> worktree add -b <branchName> <path> [baseBranch]
  // Returns the created worktree
}

export async function removeWorktree(repoRoot: string, path: string): Promise<void> {
  // git -C <repoRoot> worktree remove <path> --force
}

export async function runSetupScript(worktreePath: string, script: string): Promise<void> {
  // Execute setup script (e.g., "bun install") in the worktree directory
  // Stream output to terminal
}
```

### Database changes

Add a `worktree_path` column to the `threads` table:

**`src-tauri/migrations/NNN_thread_worktree.sql`** (new):
```sql
ALTER TABLE threads ADD COLUMN worktree_path TEXT;
ALTER TABLE threads ADD COLUMN thread_mode TEXT NOT NULL DEFAULT 'local';
-- thread_mode: 'local' | 'worktree'
```

Update `db.ts` thread functions to include `worktree_path` and `thread_mode`.

### Thread creation flow

**Modify `src/components/assistant-ui/thread.tsx` — NewThreadDialog:**

When creating a thread in a git-tracked workspace, show a mode selector:

```typescript
function NewThreadModeSelector({ workspace }: { workspace: Workspace }) {
  const [mode, setMode] = useState<"local" | "worktree">("local");
  const [branchName, setBranchName] = useState("");

  return (
    <div className="space-y-3">
      <RadioGroup value={mode} onValueChange={setMode}>
        <RadioItem value="local">
          <div>
            <div className="font-medium">Local</div>
            <div className="text-xs text-muted-foreground">
              Work directly in the main checkout
            </div>
          </div>
        </RadioItem>
        <RadioItem value="worktree">
          <div>
            <div className="font-medium">Worktree (isolated)</div>
            <div className="text-xs text-muted-foreground">
              Create an isolated copy for safe parallel work
            </div>
          </div>
        </RadioItem>
      </RadioGroup>
      {mode === "worktree" && (
        <Input
          placeholder="Branch name (e.g., feat/add-auth)"
          value={branchName}
          onChange={(e) => setBranchName(e.target.value)}
        />
      )}
    </div>
  );
}
```

### Adapter CWD override

**Modify `src/lib/claude-adapter.ts`:**

When spawning Claude CLI for a worktree thread, use the worktree path as CWD instead of the workspace CWD:

```typescript
function getEffectiveCwd(thread: Thread, workspace: Workspace): string {
  if (thread.threadMode === "worktree" && thread.worktreePath) {
    return thread.worktreePath;
  }
  return thread.cwd ?? workspace.cwd;
}
```

### Parallel agent support

Currently the adapter uses a per-thread lock (`threadLocks` Map with FIFO waiter queue). This already supports one CLI process per thread. To enable parallel agents:

1. **Each worktree thread is independent** — different CWD, different session ID, no lock contention
2. **The existing lock system prevents concurrent access within a single thread** — this stays
3. **Multiple threads can run simultaneously** — this already works architecturally, just needs the worktree isolation to make it safe

No adapter changes needed for parallelism — the worktree isolation makes it safe by design.

### Worktree cleanup

When a thread is archived/deleted, offer to clean up its worktree:

```typescript
async function cleanupThread(threadId: string) {
  const thread = await db.threads.get(threadId);
  if (thread.threadMode === "worktree" && thread.worktreePath) {
    // Prompt user: "Delete the worktree at <path>? Uncommitted changes will be lost."
    if (confirmed) {
      await removeWorktree(workspace.cwd, thread.worktreePath);
    }
  }
  await db.threads.delete(threadId);
}
```

### Worktree indicator in thread list

Show a badge in the thread list for worktree threads:

```typescript
// In ThreadList item rendering
{thread.threadMode === "worktree" && (
  <Badge variant="outline" className="text-[10px]">
    <GitBranchIcon className="mr-1 size-2.5" />
    worktree
  </Badge>
)}
```

### Effort estimate: High
- Worktree management module: ~200 LOC
- DB migration + adapter changes: ~50 LOC
- Thread creation flow changes: ~150 LOC
- Worktree cleanup: ~50 LOC
- UI indicators + integration: ~100 LOC

---

## Phase Summary

| Phase | Feature | Key Files | New Deps | Effort |
|-------|---------|-----------|----------|--------|
| **1** | Integrated Terminal | `pty.rs`, `Terminal.tsx`, `ThreadWorkspace.tsx` | `@xterm/xterm`, `portable-pty` | Medium-High |
| **2** | Git Diff & Review | `git-operations.ts`, `ChangesPanel.tsx`, `DiffViewer.tsx`, `GitActionBar.tsx` | None | Medium |
| **3A** | File @Mentions | `file-listing.ts`, `MentionPopover.tsx`, `thread.tsx` | None | Low-Medium |
| **3B** | Command Palette | `CommandPalette.tsx` | `cmdk` | Low |
| **4** | Worktree Isolation | `git-worktree.ts`, `claude-adapter.ts`, migration, `thread.tsx` | None | High |

### Dependency chain

```
Phase 1 (Terminal) ─┐
                    ├─→ Phase 4 (Worktrees + Parallel Agents)
Phase 2 (Git Diff) ─┘
                        Phase 3A (File @Mentions) — independent
                        Phase 3B (Command Palette) — independent
```

Phases 3A and 3B are independent and can be built at any time. Phases 1 and 2 are prerequisites for Phase 4.

---

## Competitive positioning after all phases

| Feature | After Plan | Conductor | Codex App | OpenCode | Kilo Code |
|---------|-----------|-----------|-----------|----------|-----------|
| Integrated Terminal | Y | Y | Y | N/A | Y |
| Git Diff Panel | Y | Y | Y | N | N |
| File Staging/Commit | Y | Y | Y | C | C |
| Worktree Isolation | Y | Y | Y | N | Y |
| Parallel Agents | Y | Y | Y | Y | Y |
| File @Mentions | Y | N | Y | N | N |
| Command Palette | Y | N | Y | N | N |
| Stream Analytics | Y | N | N | N | N |
| 5 Themes | Y | N | 2 | N | N |
| Cross-Platform | Y | N | N | Y | Y |
| Thinking Blocks | Y | N | N | N | N |

This closes the Tier 1 and major Tier 2 gaps while preserving Pluribus's unique differentiators (dev panel, themes, cross-platform, thinking blocks).

---

## What this plan does NOT cover

These features were identified in the competitive analysis but are deferred for later planning:

- **MCP Configuration UI** — Surface Claude CLI's MCP servers in a settings panel
- **Skills Browser** — Display available skills from Claude CLI init events
- **Slash Commands** — Forward slash commands to Claude CLI (partially covered by command palette)
- **Automations / Scheduled Tasks** — Background agent runs (Codex App-only feature)
- **Multi-Model Support** — Strategic constraint (Claude CLI is the agent)
- **Cloud Execution** — Requires backend infrastructure
- **Voice Input** — Nice-to-have, not table-stakes
- **Custom Modes** — Architect/Code/Debug switching (Kilo Code pattern)

These can be addressed in follow-up plans once the foundation from Phases 1-4 is in place.
