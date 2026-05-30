
# Issue #21 — Post-run Clone diff: render what the agent changed — Scope & Plan

## 1. Goal & scope

Close the POC review loop. After an agent run, compute the **Clone**'s diff against its base commit and render it in the UI so the user sees exactly what the agent changed — changed files + hunks, readable per-file. This is the **read side** of the local-first review/merge flow (local-push/merge is a later slice). It's only possible because #19 makes the clone **survive session end** with a stored `clone_dir` + `base_sha`.

**In scope:**
- A Rust command `pi_clone_diff(clone_dir, base_sha) -> Result<DiffResult, String>` returning a **discriminated** result: `no_clone | empty | git_error | diff(files)`. Never conflate empty-diff with clone-missing.
- **Correct diff semantics** (see §3 — the load-bearing decision): base vs **working tree** including untracked files, *not* `base..HEAD`.
- Per-file parsing into `FileDiff { path, base_path, status, hunks }`; **cap** total diff (~10k lines) with a truncation flag/notice.
- UI: a pull-model **"Review changes"** button shown when the thread is **completed** and a clone row exists; opens a panel listing files, each rendered via the existing **`CodePanel` (`language="diff"`)**.
- Reuse the clone metadata #19 already persists (`db.clones.getByThread`).

**Out of scope (deferred):**
- **Merge / local-push** of the agent branch and the `merged` status transition (next v1 slice).
- Clone **disposal UI** (the `dispose_clone` command exists from #19; the button is not #21's concern beyond optionally surfacing it next to the diff).
- Inline comment / per-hunk accept-reject; side-by-side split view (unified diff only for the POC).
- Live/streaming diff during the run (this is post-run, pull-model).

## 2. Architecture

Pull-model: the user clicks "Review changes" on a completed thread → frontend looks up the clone row → invokes the Rust diff command → renders the discriminated result.

```
 Thread (completed) ── "Review changes" button (visible iff completed && clone exists)
        │ onClick
        ▼
 pi-provider / a clone-diff hook
   row = await db.clones.getByThread(threadId)        // {clone_dir, base_sha, ...} or null
   if (!row) → button hidden; else:
   result = await invoke("pi_clone_diff", { cloneDir: row.clone_dir, baseSha: row.base_sha })
        │ Tauri IPC
        ▼  src-tauri/src/pi/clone.rs  (extend) or pi/diff.rs
 pi_clone_diff(clone_dir, base_sha) -> DiffResult
   if clone_dir missing on disk            → DiffResult::NoClone
   git -C <clone_dir> add -A -N            // intent-to-add: registers untracked files (see §3)
   out = git -C <clone_dir> --no-pager diff <base_sha>   // base vs WORKING TREE
   if git failed                           → DiffResult::GitError { message }
   if out empty                            → DiffResult::Empty
   else parse out → split on "diff --git " → Vec<FileDiff>, cap ~10k lines
                                           → DiffResult::Diff { files, truncated, total_lines }
        │
        ▼  UI  <CloneDiffView result=… />   (Sheet/Dialog, shadcn)
   empty   → "The agent made no changes."
   no_clone→ (button not shown)            git_error → inline error + message
   diff    → per-file collapsible Section → <CodePanel text={file.hunks} language="diff" maxLines=… />
                                            + truncation notice when truncated
```

## 3. The diff-semantics decision (load-bearing — read first)

**The issue specifies `git diff <base_sha> HEAD` (two-dot). That is wrong for this app and would ship an always-empty diff.** Verified 2026-05-30 in a real clone:

| Command | Captures the agent's edits? |
|---|---|
| `git diff <base_sha> HEAD` (issue's literal) | ❌ **0 lines** — Pi edits the **working tree** and does **not** commit, so the `agent/<id>` branch still points at `base_sha` (HEAD == base). |
| `git diff <base_sha>` (base vs working tree) | ✅ shows modified tracked files |
| `git add -A -N` then `git diff <base_sha>` | ✅ shows modified tracked files **and new/untracked files** |

Pi's native `write`/`edit` tools mutate the working tree; nothing commits. So the diff must be **base commit vs current working tree**, with untracked files made visible via `git add -A -N` (intent-to-add — registers paths without staging content; harmless on a disposable clone). `git diff <base_sha>` (one ref) compares the base tree directly to the working tree, so it also includes any commits the agent *did* make — it's the correct superset of "everything that differs from the start." **Recommendation: use `git add -A -N` + `git diff <base_sha>`** and update the gap report / ADR note that the literal `base..HEAD` is incorrect for the uncommitted-working-tree model.

(Deleted files: `add -A -N` stages deletions for diff visibility too. Renames: `git diff` detects them with `-M`; capture `base_path` from the `rename from/to` headers.)

## 4. Task breakdown

CI gate: `cargo check --all-targets` (Rust) / `bun run build` (TS). Branch off main after #29 merges (else off `feat/19-per-agent-clone`).

### Task 1 — Rust: `pi_clone_diff` + `DiffResult`
In `pi/clone.rs` (or a new `pi/diff.rs`):
```rust
#[derive(Serialize)] #[serde(tag = "kind", rename_all = "snake_case")]
pub enum DiffResult {
    NoClone,
    Empty,
    GitError { message: String },
    Diff { files: Vec<FileDiff>, truncated: bool, total_lines: u32 },
}
#[derive(Serialize)]
pub struct FileDiff { pub path: String, pub base_path: Option<String>, pub status: String, pub hunks: String }
```
`#[tauri::command] pub async fn pi_clone_diff(clone_dir: String, base_sha: String) -> Result<DiffResult, String>`:
- `Path::new(&clone_dir)` missing → `Ok(NoClone)`.
- `git -C <clone_dir> add -A -N` (best-effort; log on error, don't fail the diff).
- `git -C <clone_dir> --no-pager diff --find-renames --end-of-options <base_sha>` → non-zero exit → `Ok(GitError { message: stderr })`.
- empty stdout → `Ok(Empty)`.
- else split stdout on lines beginning `diff --git `; per chunk derive `path` (the `b/…` side), `base_path` (`a/…` when renamed), `status` (`added` from `new file`, `deleted` from `deleted file`, `renamed` from `rename to`, else `modified`); `hunks` = chunk text. Cap cumulative lines at 10_000 → set `truncated=true`, stop appending. Register in `lib.rs` `generate_handler!`. _Verify:_ `cargo check`.

### Task 2 — Shared `CodePanel` (small extraction)
`CodePanel` is duplicated inside `claude-tool-display.tsx` and `codex-tool-display.tsx` and is **not exported**. Extract one copy to `src/components/assistant-ui/code-panel.tsx` (props: `text`, `language`, `maxLines?`, `error?`) and import it in both existing files + the new diff view. Low-risk, aligns with the reuse-first component philosophy. (Alt if risky: keep duplication and add a self-contained panel — but extraction is preferred.) _Verify:_ `bun run build`.

### Task 3 — UI: `CloneDiffView` + "Review changes" trigger
- `src/components/assistant-ui/clone-diff-view.tsx`: takes the `DiffResult`; renders per-file collapsible `Section`s (reuse the `Section` pattern from the tool displays) with `<CodePanel language="diff" text={file.hunks} maxLines={…}/>`; shows file `status` badges; renders the truncation notice; `empty` → friendly "no changes"; `git_error` → inline error. Use a shadcn `Sheet` or `Dialog` as the container.
- Trigger: a "Review changes" button in the thread surface (e.g. thread header/action area), shown only when the thread's run is **complete** (assistant-ui running state false / last status `complete`) **and** `db.clones.getByThread(threadId)` returns a row. On click, fetch the row, `invoke("pi_clone_diff", { cloneDir, baseSha })`, open the view. _Verify:_ `bun run build`.

### Task 4 — docs (CONTEXT.md)
Note the review (read) loop: pull-model diff, base-vs-working-tree semantics (and why not `base..HEAD`), discriminated outcomes, 10k cap, merge/push deferred. _Verify:_ docs-only.

### Task 5 — local Docker verification (manual)
Reuse the #19 validation harness: clone a throwaway repo, mount, drive **real Pi** (`deepseek/deepseek-v4-flash` via `.env`) to edit a file + create a new file, then call the diff logic and assert: modified + added files both appear, hunks correct, empty-case works when no edits, `no_clone` when dir removed. (Can run the `git` half without cargo; full command needs the app/CI.)

## 5. Acceptance criteria

- [ ] Backend computes the clone's diff against its base commit (base vs working tree + untracked — §3).
- [ ] Diff displayed: changed files + hunks, readable per-file (`CodePanel language="diff"`).
- [ ] Diff reflects a **real run's** edits (validated with live Pi).
- [ ] **Empty-diff handled gracefully** ("no changes"), distinct from `no_clone` and `git_error`.
- [ ] Discriminated `DiffResult` (`no_clone | empty | git_error | diff`).
- [ ] Large diffs capped (~10k lines) with a truncation notice.
- [ ] "Review changes" trigger gated on `completed && clone exists`.

## 6. Risks & decisions

- **DECIDED — diff is base vs working tree (`add -A -N` + `git diff <base_sha>`), NOT `base..HEAD`.** Empirically required (§3); the issue's literal command is incorrect for Pi's uncommitted-edit model. Update the gap-report note.
- **`add -A -N` mutates the clone's index** (intent-to-add markers). Harmless on a disposable clone and not a content stage; if undesired, the alternative is `git diff <base_sha>` for tracked changes + a separate `git ls-files --others --exclude-standard` listing for new files (more code). Recommend `-N`.
- **Binary files / huge files:** `git diff` emits `Binary files differ`; the 10k-line cap bounds pathological diffs. Acceptable for POC.
- **CodePanel extraction risk:** touches two working files; keep the extraction behavior-identical (move, re-export, import) — gated by `bun run build`.
- **Trigger placement / completion signal:** confirm where "completed" is observable in the thread UI (assistant-ui run state vs a persisted thread status). Low-risk; pick the existing signal the composer already uses to toggle send/stop.
- **No local cargo/bun** → push→CI for compile; Docker present for the §5 premise check.

## 7. Suggested commit sequence & PR

Branch `feat/21-clone-diff`.
1. `feat(pi): add pi_clone_diff command + discriminated DiffResult (base vs working tree)`
2. `refactor(ui): extract shared CodePanel component`
3. `feat(ui): CloneDiffView + "Review changes" trigger (per-file diff via CodePanel)`
4. `docs: post-run clone diff — review loop, diff semantics, deferred merge (CONTEXT.md)`

**PR title:** `feat: post-run clone diff — render what the agent changed (#21)`
**Verification:** CI green; attach a live-Pi diff screenshot/log (modified + new file). Footer:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
