
# Pi POC — Pre-Implementation Gap Report

## 1. Executive Summary

The Pi POC issue chain (#17→#18→#19→#21, plus #20) is architecturally sound and built on a genuinely reusable foundation (the `CodexService` three-task Tokio stdio pattern, the `orchestrated-adapter.ts` provider seam, the assistant-ui streaming contract). However, **issue #17 is NOT ready to start as written.** Five findings dominate:

1. **Wrong launch flag everywhere (BLOCKER).** Every issue, plus CONTEXT.md and ADR 0001, specify `pi --rpc`. The verified canonical Pi API is `pi --mode rpc`. The `--rpc` shorthand is undocumented and will likely launch interactive mode or error — silently breaking the entire stdio pipeline for #17–#21. This is a one-line fix in code but must be corrected in all issue bodies and docs before any spawn code is written.

2. **Pi's protocol is NOT JSON-RPC; the "verbatim reusable" `CodexService` event layer is not reusable (BLOCKER).** Pi frames messages by `"type"` (not `"method"`/`"id"`+`"result"`). Responses are `{"type":"response","command":...,"success":bool}`. Pi events carry **no `threadId`**, and there is **no `initialize` handshake** (copying it will hang the start path forever). The three-task architecture transfers; the dispatch/correlation/routing/handshake logic must be rewritten.

3. **The single biggest undocumented Pi mapping detail will break streaming text (HIGH).** `message_update` carries deltas nested in `assistantMessageEvent.{type,delta}`, not at `message.content`. Reading the top level produces duplicated/garbled text. Equally, the provider generator must loop until `agent_end`, not return on the first `turn_end`, or multi-tool runs orphan the Pi process and show partial output.

4. **The downstream chain inherits hard `docker exec` prerequisites that are easy to miss (BLOCKER for #18/#19).** The container must be created with `open_stdin: Some(true)` AND `tty: Some(false)`, or pi stdin is silently dropped and NDJSON parsing breaks on PTY control codes. `bollard` is not yet in `Cargo.toml`. The `BufReader::lines()` stdout reader does **not** apply to bollard's `LogOutput` stream and needs a `PiIo` abstraction seam.

5. **A pervasive "per a defined policy" / persistence vacuum threatens #19 and #21 (BLOCKER for #21).** There is no schema for `clone_dir`, `base_sha`, container IDs, or Pi session state. Without these, orphan recovery, cleanup, and the #21 diff have nothing to read from. The clone retention policy that ADR 0002's review model depends on is literally undefined.

**Verdict: Do not start #17 as written.** First, (a) correct the launch flag across all issues + docs; (b) add a "Pi protocol adaptation" technical spec to #17 covering `type`-based dispatch, no-threadId routing, no-initialize handshake, `assistantMessageEvent` parsing, and `agent_end` completion; (c) add the missing acceptance criteria (error events, `pi_stop` vs `pi_abort`, app-close cleanup, agents migration). With these corrections #17 is a clean, well-scoped tracer bullet. The downstream container/clone/diff issues need their own decision pass (sequencing in §6) but are not blocked from being prepped in parallel.

---

## 2. Cross-Cutting Gaps

### Blockers (resolve before #17 implementation)

- **`pi --rpc` → `pi --mode rpc` (affects #17, #18, #19, #20, #21, CONTEXT.md, ADR 0001, ADR 0004).** Single most pervasive defect. The wrong flag propagates through every issue via the dependency chain. *Action:* global find/replace in issues + docs; confirm spawn uses `Command::new("pi").args(["--mode","rpc"])` and exec `cmd: ["pi","--mode","rpc"]`. Test empirically whether `--rpc` is even accepted as an alias (UNKNOWN).

- **Pi RPC protocol is not JSON-RPC (affects #17 core, inherited by #18/#19/#20).** `CodexService`'s `msg.get("method")`/`msg.get("id")` dispatch and `oneshot` correlation keyed on JSON-RPC `id` do not match Pi's `"type"`/`{"type":"response","command":...}` framing. *Action:* rewrite `stdout_reader` to dispatch on `msg["type"]`; include an explicit `id` on outgoing commands and match the echoed `id` (verify Pi echoes it for all response types incl. errors — UNKNOWN); define a new `PiEvent` enum. Route the `{"type":"response","command":"abort"}` line to the abort command's pending channel.

- **No persistence schema for agent/clone/container state (affects #17 crash recovery, #18 orphan recovery, #19 clone tracking, #21 diff source).** ADR 0003 says Rust is authoritative and persists to SQLite, but migrations 001–009 have no `agents`/`clones`/`sandboxes` table, no `clone_dir`, `base_sha`, `pi_session_id`, or `container_id`. *Action:* add migration 010 with a minimal `agents` table (`agent_id`, `thread_id`, `pi_session_id`, `pid`, `status`, `started_at`) and a `clones` table (or columns on `threads`) carrying `clone_dir`, `source_repo_path`, `base_sha`, `agent_branch`, `container_id`, `status`, `created_at`. This single decision unblocks #17 crash recovery, #18/#19 orphan recovery, and the #21 diff.

### High

- **`docker exec` stdin/stdout prerequisites (#18, inherited hard-dependency for #19/#20/#21).** Container MUST be created with `open_stdin: Some(true)` and the exec with `attach_stdin: Some(true)`, `tty: Some(false)`. Omitting `open_stdin` silently drops all pi commands → indefinite hang. `tty: true` corrupts NDJSON with PTY control codes. *Action:* make these mandatory fields in #18's spec with an integration test asserting a JSONL command round-trips.

- **`PiIo` abstraction seam for host vs. container I/O (#17↔#18 handoff).** `CodexService` uses `ChildStdin`/`BufReader<ChildStdout>.lines()`. bollard returns `Pin<Box<dyn AsyncWrite>>` (stdin, compatible) and `Pin<Box<dyn Stream<Item=Result<LogOutput,Error>>>>` (stdout, **incompatible** — no `.lines()`, delivers framed `LogOutput` variants). *Action:* #17 should land a `PiIo` enum (`HostProcess` / `ContainerExec`) so #18 swaps the I/O source without rewriting the three-task core. For the container variant, match `LogOutput` payload bytes → UTF-8 → split on `\n` before `serde_json::from_str`. Verify exact `LogOutput` variant names in bollard v0.20 (UNKNOWN).

- **`ANTHROPIC_API_KEY` delivery (#17 host env, #18 container env).** GUI-launched Tauri apps don't inherit shell env; Docker containers don't inherit host env. *Action:* host (#17): read key and pass via `.env("ANTHROPIC_API_KEY", value)`; container (#18): pass via `CreateExecOptions.env`. Add an acceptance criterion: actionable error if the key is absent in the spawned process. Record key-into-container as a deferred hardening item per ADR 0002's "host secrets controlled separately." Do **not** bake the key into the image.

- **Where steer maps onto assistant-ui (#20).** assistant-ui has **no mid-turn injection API** — a run is a single uninterruptible generator. Steer must be fully out-of-band: a `pi_steer_agent` Tauri command writes the steer NDJSON to Pi's stdin via the service `stdin_tx`; the UI optionally mirrors the steer into thread history via `threadRuntime.append()` for auditability. Abort maps cleanly to `threadRuntime.cancelRun()` → `abortSignal` → provider calls `pi_abort_agent`. *Action:* #20 must name both Tauri commands, their `{threadId, message}` shapes, and the visibility decision for steer messages.

### Medium

- **Concurrency governor enforcement location (ADR 0003 defers; #17/#18 are the implementation).** The 5-slot limit is "advisory UI policy unless enforced in Rust." New Tauri commands can spawn Pi sessions outside the governor. *Action:* decide now — recommend Rust enforces at spawn time, TS governor remains the UX hint. This is a maintainer decision (see §5).

- **Singleton vs. per-session service (#17 enables, #18/#20 require).** `Mutex<Option<CodexService>>` is a singleton; ADR 0003 implies many concurrent agents, CONTEXT.md says one Pi per Agent. Sufficient for #17's single-agent POC, but #18+ break. *Action:* even for #17, prefer `Mutex<HashMap<String, PiService>>` keyed by a Rust-generated `session_id` to avoid a #18 rewrite. Decision deferrable to #18 prep at the cost of rework.

- **Broadcast-channel lagged-subscriber data loss for streaming text (#17).** `RecvError::Lagged` silently skips events; for `message_update` text deltas this permanently corrupts output. *Action:* for the single-consumer-per-session POC, emit directly via `app_handle.emit()` from `stdout_reader` (no intermediate broadcast channel), eliminating the lag class entirely.

- **`onProcessStarted` callback contradicts ADR 0003 (#17).** Calling it makes TS track a stale PID/Child it shouldn't own. *Action:* pi-provider must NOT call `ctx.onProcessStarted`; schedule removal of the callback + `agent-process-manager.ts` to a post-#17 cleanup ticket (the optional `?` interface lets #17 proceed without it).

- **Startup readiness / `{"type":"ready"}` (#17 host, worse for #18 exec race).** No `initialize`, and `start_exec` returns before pi's Node loop is listening. *Action:* on spawn/exec, consume-and-discard an optional `{"type":"ready"}` line, or send a `get_state` probe and await any valid response before accepting prompts; supervisor emits `ProcessError` on timeout. Empirically test whether canonical pi emits `ready` (only confirmed in oh-my-pi fork — UNKNOWN).

---

## 3. Per-Issue Findings

### Issue #17 — Host Pi RPC bridge (tracer bullet)

| Gap | Severity |
|---|---|
| `pi --rpc` → `pi --mode rpc` | **Blocker** |
| Pi events are `type`-framed, not JSON-RPC; rewrite dispatch + correlation | **Blocker** |
| Pi events carry no `threadId`; thread_subs routing drops all events | High |
| No `initialize` handshake; copying it hangs `start()` forever | High |
| `message_update.assistantMessageEvent.{type,delta}` not mapped → streaming text breaks | High |
| `agent_end` vs `turn_end` completion boundary; multi-tool runs terminate early | Medium |
| No SQLite migration for Pi session/agent state | Medium |
| `ANTHROPIC_API_KEY` delivery to child unspecified | Medium |
| `abort` (halt op, pi lives) vs `stop` (kill process) conflated | Medium |
| Singleton blocks multi-agent (sufficient for #17 only) | Medium |
| Broadcast-channel lag drops text deltas | Medium |
| `pi --mode rpc` may need `--provider`/`--model` on fresh host (UNKNOWN) | Medium |
| `onProcessStarted` callback contradicts ADR 0003 | Low |
| Model registration / `set_model` RPC interaction unspecified | Low |

**Missing acceptance criteria to add:**
- Rust emits an actionable error event (not silent) if pi fails to spawn (binary missing, non-zero startup, key absent).
- Rust emits an actionable error event if pi exits mid-run (supervisor `ProcessError` → status `error`).
- `pi_stop` command distinct from `pi_abort`.
- On app window close, all active Pi sessions terminate (no orphans).
- Provider generator streams across multiple turns, completes only on `agent_end`.
- Provider maps `assistantMessageEvent.type` deltas, not `message.content`.
- Provider does NOT call `ctx.onProcessStarted`.
- A migration defines an `agents` table for restart survival + orphan recovery.

**Recommended additions:** add a "Pi protocol adaptation" technical-notes section enumerating the Pi event `type` strings, the response framing, the `assistantMessageEvent` delta switch, and the `agent_end` completion rule. Land the `PiIo` seam and a per-session `HashMap` to de-risk #18.

### Issue #18 — Pi inside a Sandbox via `docker exec` (bollard)

| Gap | Severity |
|---|---|
| `pi --rpc` → `pi --mode rpc` (inherited) | **Blocker** |
| Container needs `open_stdin: Some(true)` (else stdin silently dropped) | **Blocker** |
| `tty: Some(false)` required (else PTY codes corrupt NDJSON) | High |
| Orphan container recovery on restart unspecified; TS `kill_pid` can't stop containers | High |
| `#17` handoff fragility (BufReader vs LogOutput stream, singleton) | Low/High |
| `PiIo`/`LogOutput` stream stdout adaptation | Medium |
| Startup race: `start_exec` returns before pi is listening | Medium |
| Base image (Node+Pi) underspecified: no Dockerfile, version pin, registry/build strategy | Medium |
| Session-end trigger + cleanup sequence undefined | Medium |
| `ANTHROPIC_API_KEY` into container env undefined | Medium |
| `docker ps` acceptance criterion un-automatable without naming convention | Low |

**Missing acceptance criteria to add:** orphan container recovery on restart (backed by a `sandboxes`/`agents` table); API-key reachability verified inside container; deterministic container naming (`pluribus-sandbox-<thread-id-prefix>`); per-thread isolated container (not singleton); cleanup-failure UX; in-container pi startup confirmation (`get_state` returns before first prompt); pinned Pi version in image.

**Recommended additions:** check in `docker/sandbox-base/Dockerfile` with pinned Node + Pi; backend does `inspect_image`, returns a clear error if absent (404 → `DockerResponseServerError`); define `stop_sandbox(container_id)` command and the abort→wait-`agent_end`→stop→remove sequence (`t(10)`, `force(true)`, `v(true)`).

### Issue #19 — Per-agent Clone (`git clone --local`) bind-mounted

| Gap | Severity |
|---|---|
| No clone host-dir location policy (XDG/`app_data_dir`) | **Blocker** |
| `bollard` not in `Cargo.toml` (blocks #18, transitively #19) | High |
| Container `open_stdin: Some(true)` cross-dependency on #18 | High |
| Branch naming scheme unspecified (recommend `agent/<thread-id>`) | High |
| Container-side mount path unspecified (`/workspaces/<thread-id>/`) | High |
| No SQLite schema for clone records | Medium |
| Source-repo selection: no git-repo validation of `cwd` | Medium |
| Cleanup/retention policy undefined ("per a defined policy") | Medium |
| `pi --rpc` flag (inherited) | Medium |
| Orphan clone-dir cleanup on crash | Medium |
| Isolation guarantee has no verification mechanism | Low |
| Large-repo clone time: no async progress/timeout | Low |
| Pi `--session-dir` location inside container unspecified | Low |
| Shared-sandbox multi-clone path collision unaddressed | Low |

**Missing acceptance criteria to add:** define the retention policy explicitly (not a placeholder); orphan clone recovery on startup; source-repo git validation with user-visible error; capture `base_sha` via `rev-parse HEAD` before `checkout -b`; declare container mount path; declare branch scheme; `git clone` failure → thread status `error` + UI message; cross-verify #18 `open_stdin`.

**Recommended additions:** clone root = `app_data_dir()/clones/<thread-id>/` resolved TS-side, passed to Rust; add `bollard = { version = "0.20" }`; scope POC to one-agent-per-sandbox and defer shared-sandbox path routing with a CONTEXT.md note.

### Issue #20 — Real-time control: steer + abort

| Gap | Severity |
|---|---|
| `pi --rpc` flag inherited from #17 | **Blocker** |
| No `pi_steer_agent` Tauri command / routing defined | High |
| Steer UI placement & interaction model unspecified | High |
| Steer delivery timing misrepresented (fires after whole turn's tools, not one) | Medium |
| Steer bypasses assistant-ui message model; visibility/persistence unspecified | Medium |
| "Agent actively running" detection (Rust-authoritative status vs `thread.isRunning`) | Medium |
| `pi_abort_agent` chain not fully specified | Low |
| Abort-ack race: events arriving after abort before quiet | Low |
| Abort while idle: undefined Pi behavior | Low |

**Missing acceptance criteria to add:** steer message persistence decision; `queue_update` surfacing ("steer queued, applies next turn"); UI state for a tool left `running` when aborted mid-tool; steer-failure (`success:false`) UX; steer input JSON-string escaping (no raw newlines breaking NDJSON); session resumability after abort; double-steer queue/dedup behavior; accessibility (aria-label, Enter/Escape).

**Recommended additions:** define `pi_steer_agent({threadId, message})` and `pi_abort_agent({threadId})`; gate steer enable on Rust-authoritative `agent_status === 'running'`; correct UI copy to "takes effect at next turn boundary"; render steer as an appended user message with `metadata:{isSteered:true}`; declare `follow_up` and mid-run `set_model` as in-scope or explicit non-goals.

### Issue #21 — Post-run Clone diff

| Gap | Severity |
|---|---|
| No `clone_dir`/`base_sha` schema — diff has no source | **Blocker** |
| Clone retention must outlive session (depends on #19 policy) | Medium |
| Empty-diff vs clone-missing vs git-error conflated | Medium |
| Diff wire format (raw string vs structured) unspecified | Low |
| Trigger mechanism (push vs pull) unspecified | Low |
| Two-dot vs three-dot `git diff` form unspecified | Low |
| Large-diff DOM blow-up on expand | Low |

**Missing acceptance criteria to add:** Tauri command distinguishes `no_clone` / `git_error` / `empty` / `diff`; schema migration (shared with #19) defined before implementation; clone survives until explicit user disposal; agreed command surface (name/params/return) for parallel Rust/TS dev; git subprocess error handling; concrete UI trigger; max-diff-size bound.

**Recommended additions:** return `Result<DiffResult,String>` where `DiffResult` is a discriminated enum; store `base_sha` at clone time and use deterministic two-dot `git diff <base_sha> HEAD`; return `Vec<FileDiff>{path, base_path, hunks}` and render each via existing `CodePanel` (`language='diff'`); pull-model "Review changes" button shown when `agent_status === 'completed' && clone_dir != null`; cap total diff (~10k lines) with truncation notice.

---

## 4. Doc / ADR Updates Needed

1. **CONTEXT.md & ADR 0001 & ADR 0004 — flag correction.** Replace all `pi --rpc` with `pi --mode rpc`. The canonical Pi docs are authoritative. (Flag whether `--rpc` is even accepted as an alias — currently UNKNOWN, test empirically.)

2. **ADR 0003 — "Phase 1 removed the Tauri shell plugin (security)" is factually false.** `tauri-plugin-shell` is still in `Cargo.toml`, `default.json` still grants `shell:allow-spawn`/`shell:allow-execute` for codex + agent-sdk-bridge, and the plugin is still initialized in `lib.rs`. *Edit:* change to "the shell plugin **will be** removed once Pi container lifecycle (bollard) replaces codex/agent-sdk spawning." Do not let #18 remove it (codex still needs it).

3. **New ADR — "Pi RPC protocol is not JSON-RPC."** Record that Pi frames by `"type"`, responses are `{"type":"response","command":...,"success":bool}`, events carry no `threadId`, there is no `initialize` handshake, `message_update` deltas are nested in `assistantMessageEvent`, and completion is `agent_end` (not `turn_end`). This directly contradicts the "CodexService verbatim reusable" framing in the current reuse notes and must be captured so it doesn't get re-assumed.

4. **CONTEXT.md / ADR 0003 — schema reality vs. authority claim.** ADR 0003 says Rust is the SQLite-persisted source of truth for agents, but the schema (001–009) has no `agents`/`clones`/`sandboxes` tables. Add a note that migration 010+ introduces these; until then the authority claim is aspirational.

5. **New ADR or CONTEXT.md note — clone retention policy.** ADR 0002's "post-hoc review of the clone's branch diff before merging" requires clones to **survive session end and app restart until explicit user disposal**. This contradicts #19's open-ended "cleaned up (or retained) per a defined policy." Record retain-until-user-action as authoritative, with `clone_status: 'active'|'merged'|'discarded'`.

6. **ADR 0002 — add `queue_update` to the observe set.** If steer queuing is surfaced to the user (recommended), `queue_update` is a live-observe event and should be listed alongside `message_update`/`tool_execution_*`.

7. **CONTEXT.md — concurrency enforcement.** Once decided (§5), record whether the 5-slot limit is Rust-enforced or TS-advisory.

---

## 5. Open Questions for the Maintainer (checklist)

Decisions only a human can make:

- [ ] **Concurrency enforcement:** Rust enforces the 5-slot limit at spawn, or TS governor stays advisory-only? (ADR 0003 defers; #17 forces the choice.)
- [ ] **Clone retention policy:** retain-until-user-action (recommended, matches ADR 0002), retain-N-days, or retain-only-while-container-runs?
- [ ] **Steer message visibility:** appear in chat history (recommended, `append()` with `metadata.isSteered`), DevPanel-only, or invisible/fire-and-forget?
- [ ] **`follow_up` and mid-run `set_model` scope:** in-scope for #20, or explicit non-goals?
- [ ] **Per-session vs singleton service in #17:** build `HashMap<session_id, PiService>` now (avoids #18 rework) or accept singleton + later rewrite?
- [ ] **Container model for #18:** one container per agent (true isolation) or shared container with multiple execs? (CONTEXT.md allows both.)
- [ ] **Base image provisioning for #18:** developer pre-builds via checked-in Dockerfile + backend `inspect_image` error, or backend auto-builds via bollard `build_image`?
- [ ] **Pi version to pin** in the Dockerfile, and install method (global npm / local copy / compiled binary)?
- [ ] **Pi session persistence in containers:** ephemeral per-container (accept loss) or second bind-mount for `--session-dir`?
- [ ] **Diff command form & "base":** two-dot vs three-dot; "base" = stored source-HEAD SHA (recommended) or named branch?
- [ ] **Branch naming scheme:** confirm `agent/<thread-id>`.
- [ ] **Empirical Pi behaviors to test before coding:** does `--rpc` alias work? does canonical pi emit `{"type":"ready"}`? does pi echo `id` on all responses incl. errors? does `pi --mode rpc` need `--provider`/`--model` on a fresh host? what does `abort` return when idle? does dropping stdin make pi exit cleanly?

---

## 6. Recommended Sequencing Adjustments

The base order #17→#18→#19→#21 (with #20 hanging off #17) is correct. Adjustments:

1. **Pre-work spike before #17 (new, ~½ day):** an empirical Pi smoke test resolving the UNKNOWNs that gate #17's code shape — flag alias, `ready` event, `id` echo, fresh-host `--provider`/`--model`, idle-`abort`, stdin-EOF exit. This converts blockers/UNKNOWNs into known facts before any service code is written.

2. **Flag + protocol-ADR correction first (no code):** apply §4 doc edits and the §3 issue-body corrections across all five issues. Cheap, prevents the defect from propagating through the whole chain.

3. **Fold two de-risking deliverables into #17:** (a) the `PiIo` host/container I/O seam, and (b) a per-session `HashMap` service. Both are small in #17 and expensive to retrofit in #18. This makes #18 a near-pure "swap I/O source + add container lifecycle" change.

4. **Move bollard + the persistence schema earlier.** Add `bollard` to `Cargo.toml` and land migration 010 (`agents` + `clones`/`sandboxes`) as a shared prerequisite **before** #18/#19, rather than inside them. #19 and #21 both read this schema; #17's crash recovery and #18's orphan recovery both need it.

5. **#20 can proceed in parallel with #19** once #17 lands — it depends only on the RPC bridge, not on clones/containers. It does not need to wait behind #18/#19.

6. **Keep #21 last but design its Tauri command surface during #19** (both touch clone metadata), so Rust and TS can develop the diff path in parallel against an agreed `DiffResult` contract.

Net: insert a Pi-smoke spike + a docs/flag correction pass + a schema/bollard prerequisite ahead of #17, fold `PiIo` and per-session service into #17, run #20 alongside #19. The dependency backbone is otherwise unchanged.

---

## 7. Empirical Addendum (verified against installed Pi binary)

Verified directly against `@mariozechner/pi-coding-agent` **v0.67.68** installed at
`~/.nvm/.../lib/node_modules/@mariozechner/pi-coding-agent` (binary `pi`), via `--help`,
`--list-models`, a live `--mode rpc` probe, and the package's own `.d.ts` protocol types
(`dist/modes/rpc/rpc-types.d.ts`) and `AgentEvent` (`pi-agent-core/dist/types.d.ts`).
This supersedes the web-sourced "External Facts" where they differ.

### Confirmed
- **Launch flag:** `pi --mode rpc` is correct (`--mode <text|json|rpc>`). `--rpc` is NOT a flag. (Report §1.1 confirmed.)
- **Not JSON-RPC:** commands are `{ "type": "<cmd>", "id?": string, ... }`; responses are
  `{ "type":"response", "command":"<cmd>", "success":bool, "data?"|"error?" }`. Live probe matched exactly. (Report §1.2 confirmed.)
- **No `ready` event:** launching `pi --mode rpc` with no input emits nothing; readiness must be probed (e.g. `get_state`). (Report UNKNOWN resolved → no ready line.)
- **Streaming/text:** event union confirms `message_update.assistantMessageEvent` carries deltas, and
  `agent_end` (not `turn_end`) is the run terminator. (Report §1.3 confirmed — provider must loop to `agent_end`.)
- **JSONL framing:** package explicitly documents LF-only framing; clients MUST split on `\n` only
  (U+2028/U+2029 may appear inside JSON strings — do NOT use Node readline / equivalents).
- **steer / abort / set_model / follow_up all real:** `{type:"steer",message}`, `{type:"abort"}`,
  `{type:"set_model",provider,modelId}`, `{type:"follow_up",message}`. `prompt` also accepts
  `streamingBehavior?: "steer"|"followUp"`. State exposes `steeringMode`/`followUpMode` = `"all"|"one-at-a-time"`.

### Provider model (corrects the ANTHROPIC_API_KEY assumption)
- Pi is **provider-agnostic**: `--provider <name>`, `--model <provider/id>`, `--api-key`, `--list-models`.
  The `ANTHROPIC_API_KEY`-specific framing in the issues/CONTEXT.md/ADRs is too narrow — Pluribus must let the
  agent be launched with an arbitrary provider+model+key, not assume Anthropic.
- This machine's resolved default is **`openai-codex/gpt-5.4`** (baseUrl `chatgpt.com/backend-api`), i.e. Pi can
  drive OpenAI **Codex/GPT-5.x** via a `codex login` (ChatGPT) session, not just API keys. Providers Pi could
  enumerate offline here: `anthropic`, `openai-codex`.

### NEW gap not in the original report — `extension_ui_request` round-trip (HIGH)
The wire protocol includes `extension_ui_request` (`confirm`/`select`/`input`/`editor`/`notify`/`setStatus`/
`setWidget`/`setTitle`/`set_editor_text`) and a matching `extension_ui_response`. ADR 0002 is still correct that
*native* tools run without approval, BUT any **Skill or Extension** that calls `extension_ui_request` will **block
the agent indefinitely** unless the Rust bridge replies with `extension_ui_response`. The bridge MUST handle this
loop (minimum: auto-respond/cancel; better: surface select/confirm/input to the UI). Add to #17 acceptance criteria.

### Full command surface (richer than the issues assume)
Beyond prompt/steer/abort/set_model: `follow_up`, `new_session`, `get_state`, `cycle_model`, `get_available_models`,
`set_thinking_level`, `cycle_thinking_level`, `set_steering_mode`, `set_follow_up_mode`, `compact`,
`set_auto_compaction`, `set_auto_retry`, `abort_retry`, `bash`, `abort_bash`, `get_session_stats`, `export_html`,
`switch_session`, `fork`, `get_fork_messages`, `get_last_assistant_text`, `set_session_name`, `get_messages`,
`get_commands`. Pi also ships an official **`RpcClient`** (TypeScript reference driver) we can mirror in Rust.

### Live RPC runtime validation (2026-05-30, openrouter / deepseek-v4-flash)

Drove `pi --mode rpc --provider openrouter --model deepseek/deepseek-v4-flash` over stdio with a Node
harness (key read from repo `.env` and injected into the child env — Pi has no dotenv layer). All confirmed
against the real wire:

- **Provider-agnostic in practice:** OpenRouter worked end-to-end; resolved model `{provider:"openrouter",
  api:"openai-completions", baseUrl:"https://openrouter.ai/api/v1"}`. Confirms the "not Anthropic-only" correction.
- **Event lifecycle order:** `response(prompt ack)` → `agent_start` → `turn_start` → `message_start/message_end`
  **(role:"user" — the prompt is echoed back; provider MUST skip it)** → `message_start`(assistant) →
  N×`message_update` → `message_end` → `turn_end` → `agent_end`. The `id` is echoed on every response and the
  ack arrives BEFORE the event stream (request/response correlation by `id` works).
- **`assistantMessageEvent` sub-taxonomy:** `thinking_start|thinking_delta|thinking_end` then
  `text_start|text_delta|text_end`, each with `contentIndex`, `delta` (increment) and `partial` (accumulator).
  Reasoning models (deepseek-v4-flash) stream thinking (contentIndex 0) before text (contentIndex 1). Map
  `text_delta`→visible, `thinking_delta`→reasoning UI; never read `message.content` for deltas.
- **Tool events:** `tool_execution_start {toolCallId,toolName,args}` → `tool_execution_end {toolCallId,toolName,
  result,isError}`, PLUS a `message` with `role:"toolResult"`. Provider uses `tool_execution_*` for live display.
- **steer = QUEUED, not a mid-token interrupt.** Sending `steer` mid-stream returned `{"type":"queue_update",
  "steering":[...]}` + `{command:"steer",success:true}` but generation continued; the steer applies at the next
  TURN boundary (in `one-at-a-time` mode). UI copy must say "applies at next step", and surface `queue_update`.
  → confirms #20 medium gap.
- **abort = prompt & clean: ~6ms** from `abort` to `agent_end`, followed by `{command:"abort",success:true}`.
  `agent_end` precedes the abort ack, so treat `agent_end` as the terminator. → confirms #20 "stops promptly".
- **stdin EOF → clean exit (code 0).** Resolves the report's "does dropping stdin exit cleanly" UNKNOWN: yes.
- **⚠️ Host-tool execution demonstrated (ADR 0002 made concrete):** given a long task, the agent invoked Pi's
  native `write` tool and wrote a 21KB file to `/tmp` on the **host** with no approval — exactly the unsandboxed
  blast radius #17 carries until #18's container lands. Strong empirical argument for prioritizing #18 and for
  not running #17 against any real working tree. (Artifact cleaned up.)
