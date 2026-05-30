
# Issue #19 — Per-agent Clone (`git clone --local`) bind-mounted into the Sandbox: Scope & Plan

## 1. Goal & scope

Give each agent an **isolated working copy**. The backend makes a **Clone** of a **Source repo** via `git clone --local` (hardlinked `.git/objects` — *not* `--shared`, so the source's `gc` can't corrupt the clone) and **bind-mounts** it into the per-agent Sandbox container from #18. Pi operates on the mounted clone with its **native tools** (no tool overriding), on its own branch `agent/<thread-id>`. The Source repo on disk is **never mutated**. The clone is the **isolation unit** that later lets multiple agents coexist without colliding, and the durable artifact that #21's post-run diff reviews.

**In scope:**
- Host-side clone lifecycle: `git clone --local <source> <clone_dir>`, capture `base_sha` (`git rev-parse HEAD`) **before** `git checkout -b agent/<thread-id>`.
- Source-repo **validation** (`git rev-parse --is-inside-work-tree`) with a user-visible error; failed clone → thread status `error` + UI message.
- Bind-mount the clone into the container at `/workspaces/<thread-id>/` (add `host_config.binds` to the #18 `create_container` body) and run the `pi --mode rpc` **exec with `working_dir` = the mount** (Pi has **no `--cwd` flag** — it uses the process cwd).
- New migration **`011_clones.sql`** + TS `db.clones` CRUD (DB is TS-only — see [[global-settings-ts-only]]).
- **Retention policy (defined, not placeholder):** the clone is **NOT** deleted on session/agent end. `pi_stop` / window-close stop+remove the *container* but **leave the clone dir** so the run can be reviewed (#21). Disposal is **explicit** (`status: active | merged | discarded`); a `dispose_clone` command `rm -rf`s the dir and marks `discarded`.
- Orphan **clone-dir** recovery on startup: reconcile the `clones` table against disk; remove only dirs whose row is `discarded`/missing — never retained `active` clones.
- `clone_root` = `app_data_dir()/clones/` resolved **app-side** (Tauri path API) and passed to Rust as a param (same pattern as `sandbox` in #18).

**Out of scope (deferred):**
- The **diff/review UI and merge action** (#21) — #19 produces the durable clone + `base_sha` + branch that #21 reads; the "Review changes" surface and the `merged` transition belong to #21.
- **Shared-sandbox multi-clone** path routing — POC is **one agent per sandbox** (note in CONTEXT.md).
- Pushing the agent branch anywhere / network egress (ADR 0002 — not contained; out of scope).
- Pi `--session-dir` placement (Pi's own session files stay at the container default `~/.pi`; ephemeral, dies with the container).

## 2. Architecture — where it slots into #18

The clone work brackets the existing `ContainerExec::spawn`. Two new touch-points in the container path, one new host-side step, one new table.

```
 pi-provider.ts.run(ctx)
   ├─ resolve cloneRoot = appDataDir()/clones         (Tauri path API, TS-side)
   ├─ source = ctx.cwd  (workspace's repo path)        ← already on RunContext (types.ts:36)
   └─ invoke("pi_start_session", { sessionId, provider, model, sandbox,
                                    sourceRepo: ctx.cwd, cloneRoot })
        │
        ▼  src-tauri/src/pi/
 commands.rs  pi_start_session
   1. validate sourceRepo is a git work-tree → else Err (UI toast, thread=error)
   2. clone::create_agent_clone(sourceRepo, cloneRoot, thread_id):
        clone_dir = <cloneRoot>/<thread_id>
        base_sha  = git -C <source> rev-parse HEAD
        git clone --local <source> <clone_dir>
        git -C <clone_dir> checkout -b agent/<thread_id>
        → returns CloneInfo { clone_dir, base_sha, agent_branch }
   3. ContainerExec { container_name, mount: (clone_dir, "/workspaces/<thread_id>") }
   4. PiService::start(... io=&container ...)   ← #18 path, unchanged except mount
   5. on success: return CloneInfo to TS to persist the `clones` row
        │
        ▼  container.rs  ContainerExec::spawn   (#18 + two lines)
   create_container( ContainerCreateBody {
       image, open_stdin:true, labels{managed},
       host_config: Some(HostConfig { binds: Some(vec![
           format!("{clone_dir}:/workspaces/{thread_id}")          // ← NEW (rw)
       ]), ..Default::default() }),
       ..})
   create_exec( CreateExecOptions {
       cmd:["pi","--mode","rpc","--provider",p,"--model",m],
       working_dir: Some("/workspaces/<thread_id>"),                // ← NEW (Pi has no --cwd)
       env, attach_*:true, tty:false, ..})
```

**`base_sha` capture:** taken from the **source HEAD before** the clone (== the clone's HEAD immediately after `git clone`, before `checkout -b`). Stored so #21 can `git diff <base_sha> HEAD` deterministically.

**Note — committed state only:** `git clone --local` copies the source's *committed* objects; uncommitted working-tree changes in the source are NOT in the clone. The agent works from `base_sha` (last commit). Document this in CONTEXT.md so it isn't surprising.

## 3. Task breakdown

Each task independently committable; CI gate = `cargo check --all-targets` (Rust) / `bun run build` (TS). Builds on the green #18 branch (merge #18 first, or branch from it).

### Task 1 — migration `011_clones.sql` + register in lib.rs
`clones` table (snake_case, TEXT timestamps like 010):
```sql
CREATE TABLE IF NOT EXISTS clones (
  clone_id         TEXT PRIMARY KEY,
  thread_id        TEXT,
  source_repo_path TEXT NOT NULL,
  clone_dir        TEXT NOT NULL,
  base_sha         TEXT NOT NULL,
  agent_branch     TEXT NOT NULL,
  container_id     TEXT,
  status           TEXT NOT NULL DEFAULT 'active',  -- active|merged|discarded
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now'))
);
CREATE INDEX IF NOT EXISTS idx_clones_thread_id ON clones(thread_id);
CREATE INDEX IF NOT EXISTS idx_clones_status    ON clones(status);
```
Register as `Migration { version: 11, … }`. _Verify:_ `cargo check` (`include_str!`).

### Task 2 — `pi/clone.rs` (host git clone lifecycle)
`create_agent_clone(source: &str, clone_root: &str, thread_id: &str) -> Result<CloneInfo, String>`:
- Validate `git -C <source> rev-parse --is-inside-work-tree` → else `Err("not a git repository: {source}")`.
- `base_sha = git -C <source> rev-parse HEAD` (trim).
- `clone_dir = <clone_root>/<thread_id>`; refuse if it already exists non-empty (idempotency).
- `git clone --local <source> <clone_dir>` → on non-zero, `Err` with stderr.
- `git -C <clone_dir> checkout -b agent/<thread_id>`.
- Return `CloneInfo { clone_dir, base_sha, agent_branch }`.
`dispose_clone(clone_dir)`: `std::fs::remove_dir_all` (best-effort), used by the dispose command + startup reconcile. Uses `std::process::Command::new("git")` (host git, confirmed 2.43). _Verify:_ `cargo check`.

### Task 3 — `ContainerExec` bind-mount + exec working_dir
Add `mount: Option<(String /*host*/, String /*container*/)>` to `ContainerExec`; when set, populate `host_config.binds` and the exec `working_dir`. Host path unchanged. _Verify:_ `cargo check`.

### Task 4 — `commands.rs` orchestration
`pi_start_session` gains `source_repo: Option<String>`, `clone_root: Option<String>`. When `sandbox==container` and both present: validate → `create_agent_clone` → build `ContainerExec` with the mount → start. On any failure, surface `Err` (TS sets thread `error`) and DON'T leave a half-clone (cleanup on error path, but NOT on success). Return `CloneInfo` (serde) so TS persists the row. `dispose_clone` Tauri command. _Verify:_ `cargo check`.

### Task 5 — `pi-provider.ts` + `db.clones`
- Resolve `cloneRoot` via Tauri path API (`appDataDir()` + `/clones`); pass `sourceRepo: ctx.cwd` + `cloneRoot` to `pi_start_session`; persist the returned `CloneInfo` via `db.clones.create(...)`. On reject, set thread status `error` + toast.
- `db.clones`: `create`, `getByThread`, `setStatus`, `listActive` (mirror `db.globalSettings`/agents helpers). _Verify:_ `bun run build`.

### Task 6 — startup orphan clone reconcile
On setup (alongside #18's `reap_managed_containers`): TS lists `clones` rows; remove on-disk dirs with no row or `status=discarded`; leave `active`. (Disk-walk + DB compare; TS-driven since DB is TS-only — a small `reconcileClones()` called at boot.) _Verify:_ `bun run build`.

### Task 7 — CONTEXT.md
Clone-as-isolation-unit; `git clone --local` (hardlink, not `--shared`) rationale; branch `agent/<thread-id>`; mount `/workspaces/<thread-id>`; retention = retain-until-explicit-dispose; committed-state-only caveat; one-agent-per-sandbox (shared deferred). _Verify:_ docs-only.

### Task 8 — local docker verification (manual, has Docker)
Throwaway repo → clone+mount → `docker exec` Pi edits a file → assert: clone file changed, **source unchanged**, clone on `agent/<thread-id>`, `git -C clone diff base_sha` shows the edit. _Verify:_ scripted docker run (no cargo needed for the premise).

## 4. Acceptance criteria (from issue + gap report)

- [ ] Backend `git clone --local` of a chosen source into a host dir.
- [ ] Clone bind-mounted; Pi reads/writes it natively (exec `working_dir` = mount).
- [ ] Pi editing a file changes the **clone**; **source repo unchanged**.
- [ ] Clone created on branch `agent/<thread-id>`; `base_sha` captured before branching.
- [ ] Retention = retain until explicit disposal (`active|merged|discarded`); NOT cleaned on session end; `dispose_clone` removes it.
- [ ] Source-repo git validation + clear error; failed clone → thread `error` + message.
- [ ] Orphan clone-dir recovery on startup (reconcile vs `clones` table; retained clones survive).
- [ ] `clones` schema (migration 011) with the documented columns.
- [ ] One-agent-per-sandbox (shared deferred, noted).

## 5. Risks & decisions

- **DECIDED — Source repo = workspace `cwd`.** Use `RunContext.cwd` (the repo path already attached to the thread's workspace); no dedicated repo picker in #19. Reuses existing plumbing.
- **DECIDED — #19 stops at the command surface.** Ships the `status` field (`active|merged|discarded`) + the `dispose_clone` command + startup reconcile. The "Review changes" UI, the dispose *button*, and the `merged` transition belong to #21.
- **Committed-state-only:** the agent works from `base_sha`, not the source's uncommitted edits (`--local` copies committed objects). Acceptable for the POC; documented.
- **Mount is read-write** (Pi must edit) — `binds` without `:ro`. The container/clone is the blast radius (ADR 0002); the source is protected by being a *separate clone*, not by mount read-only.
- **Clone disk growth:** retained clones accumulate under `app_data_dir/clones/`. Hardlinked objects keep `.git` cheap, but working trees add up. Disposal is user-driven; a retention cap is a future concern (note, don't build).
- **Cross-fs `--local`:** if `clone_root` and source are on different filesystems, git falls back to copying objects (not hardlinks) — still correct, just larger. Acceptable.
- **No local `cargo`/`bun`** → push→CI for compile; Docker present for the Task 8 premise check, as in #18.

## 6. Suggested commit sequence & PR

Branch `feat/19-per-agent-clone` (off main once #18 merges, else off `feat/18-pi-sandbox-bollard`).
1. `feat(db): add migration 011 clones table`
2. `feat(pi): add clone.rs — git clone --local lifecycle + base_sha + agent branch`
3. `feat(pi): bind-mount clone into ContainerExec + exec working_dir`
4. `feat(pi): orchestrate clone in pi_start_session + dispose_clone command`
5. `feat(ui): pass source/cloneRoot, persist clones row, error handling (pi-provider + db.clones)`
6. `feat(pi): startup orphan clone reconcile (retain active, reap discarded)`
7. `docs: clone-as-isolation-unit, retention policy, mount/branch scheme (CONTEXT.md)`

**PR title:** `feat: per-agent git clone bind-mounted into the sandbox (#19)`
**Verification:** CI green; attach a Docker premise check (clone edited, source untouched, on agent branch). Footer:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
