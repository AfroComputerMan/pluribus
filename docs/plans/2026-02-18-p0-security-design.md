# P0 Security Fixes Design

**Date**: 2026-02-18
**Issues**: CRIT-1 (XSS via dangerouslySetInnerHTML), CRIT-2 partial (remove sh from git ops)

---

## CRIT-1: XSS — Replace `dangerouslySetInnerHTML` with React Element Parser

### Problem

`HighlightedCode` in `claude-tool-display.tsx` renders syntax-highlighted code via:

```tsx
<code dangerouslySetInnerHTML={{ __html: html }} />
```

where `html` is the output of `hljs.highlight()` or `hljs.highlightAuto()`. If a grammar
vulnerability exists or crafted input bypasses escaping, this is a direct XSS vector. In
Tauri's webview, XSS + unrestricted shell access = full remote code execution.

### Fix

Add a `parseHljsHtml(html: string): ReactNode[]` function in `claude-tool-display.tsx`.

highlight.js output only ever contains `<span class="hljs-*">text</span>` and plain text.
The parser:

1. Uses a regex to split the string into typed segments: `{ type: "span", className: string, text: string }` and `{ type: "text", text: string }`
2. Converts each segment to a safe React node — `<span className="hljs-...">` for highlighted tokens, raw strings for plain text
3. React handles all escaping of string children automatically — no injection path exists

`HighlightedCode` switches from `dangerouslySetInnerHTML` to rendering the parsed node array.

**Regex pattern**: `/<span class="([^"]*)">([\s\S]*?)<\/span>/g` — only matches the exact
structure hljs produces. Anything not matching this pattern (including nested spans or other
tags) is treated as plain text and escaped by React.

**No new dependencies.** Visual output is identical.

### Files Changed

- `src/components/assistant-ui/claude-tool-display.tsx` — add `parseHljsHtml`, update `HighlightedCode`

---

## CRIT-2 (Moderate): Remove `sh` from Git Operations

### Problem

All git operations use `Command.create("claude-stream-sh", ["-c", SCRIPT, ...positional_args])`.
The `claude-stream-sh` command maps to `sh` with `"args": true` in Tauri capabilities. This
means any JavaScript in the webview (including via XSS) can run:

```js
Command.create("claude-stream-sh", ["-c", "rm -rf ~"])
```

### Fix

Replace all git shell scripts with direct `Command.create("git", [...])` calls. Add `git`
as a named command in `capabilities/default.json`. This eliminates `sh` as the execution
context for git — `git` can only run git operations, not arbitrary commands.

`claude-stream-sh` (sh) is retained for Claude CLI invocation, which needs shell for the
`< /dev/null` stdin redirect embedded in `CLAUDE_SHELL_SCRIPT`.

### Git Capability Entry

```json
{
  "name": "git",
  "cmd": "git",
  "args": true
}
```

Added under both `shell:allow-spawn` and `shell:allow-execute` allow lists.

### Functions to Rewrite

#### `workspace-repo-metadata.ts`

**`getWorkspaceRepoMeta(cwd)`** — replace `WORKSPACE_GIT_META_SCRIPT` with sequential commands:
1. `git -C <cwd> rev-parse --show-toplevel` → repoRoot
2. `git -C <repoRoot> rev-parse --abbrev-ref HEAD` → branch
3. `git -C <repoRoot> config --get remote.origin.url` → remoteUrl (may fail → null)
4. `git -C <repoRoot> log -1 --format=%cI` → lastCommitAt (may fail → null)
5. `git -C <repoRoot> rev-list --left-right --count @{upstream}...HEAD` → behind/ahead (may fail → null)

Parse repoSlug/isGithub/repoName from remoteUrl in TypeScript (no `sed` needed).

**`listWorkspaceBranches(cwd)`** — replace `LIST_BRANCHES_SCRIPT`:
1. `git -C <cwd> rev-parse --show-toplevel` → repoRoot
2. `git -C <repoRoot> rev-parse --abbrev-ref HEAD` → currentBranch
3. `git -C <repoRoot> for-each-ref --format=%(refname:short) refs/heads` → branch list (split stdout on newlines)

**`switchWorkspaceBranch(cwd, branch)`** — replace `SWITCH_BRANCH_SCRIPT`:
1. `git -C <cwd> rev-parse --show-toplevel` → repoRoot
2. `git -C <repoRoot> checkout <branch>`

**`createWorkspaceBranch(cwd, branch)`** — replace `CREATE_BRANCH_SCRIPT`:
1. `git -C <cwd> rev-parse --show-toplevel` → repoRoot
2. `git -C <repoRoot> checkout -b <branch>`

#### `claude-adapter.ts`

**`ensureBranchCheckedOut(cwd, branch)`** — replace `ENSURE_BRANCH_SCRIPT`:
1. `git -C <cwd> rev-parse --show-toplevel` → repoRoot (exit 0 if fails — not a repo)
2. `git -C <repoRoot> rev-parse --abbrev-ref HEAD` → currentBranch
3. If currentBranch === target: return true
4. `git -C <repoRoot> show-ref --verify --quiet refs/heads/<target>` → branch exists? (exit 2 if not)
5. `git -C <repoRoot> checkout <target>`

### Helper

Add a `runGit(args: string[], opts?: { cwd?: string }): Promise<{ stdout: string; code: number | null }>`
helper at the top of `workspace-repo-metadata.ts` to avoid repetitive `Command.create("git", args, opts).execute()` boilerplate.

### Files Changed

- `src-tauri/capabilities/default.json` — add `git` command to both allow lists
- `src/lib/workspace-repo-metadata.ts` — rewrite all 4 exported functions; remove shell scripts; add `runGit` helper
- `src/lib/claude-adapter.ts` — rewrite `ensureBranchCheckedOut`; remove `ENSURE_BRANCH_SCRIPT`
