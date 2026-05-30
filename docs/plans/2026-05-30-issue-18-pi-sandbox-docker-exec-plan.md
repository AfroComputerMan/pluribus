
# Issue #18 — Pi inside a Sandbox via `docker exec` (bollard): Implementation Plan

## 1. Goal & scope

Move the live `pi --mode rpc` process from the **host** (where #17 left it) into a per-agent **Docker container**, driven via `docker exec` using the **bollard** Rust Docker client. The chat experience is byte-for-byte unchanged from the user's view; the difference is that Pi now executes inside a container (verifiable with `docker ps`), so its native `write`/`edit`/`bash` tools hit the container filesystem instead of the real machine — this is the moment ADR 0002's sandbox safety boundary actually exists.

#17 deliberately pre-built the swap point: `src-tauri/src/pi/io.rs` already defines a `PiIo` trait with a live `HostProcess` impl and a compiling `ContainerExec` **stub** that returns `Err("…deferred to #18")`. The bulk of #18 is (a) **reshaping the `PiIo` seam's return type** so a container's stream-based stdio fits where `service.rs` currently expects concrete tokio `Child`/`ChildStdout`/`ChildStdin`, and (b) implementing `ContainerExec` + the container lifecycle around it. **`service.rs`'s reader/writer/supervisor logic and the entire frontend (`pi-provider.ts`, orchestrated-adapter, UI) stay unchanged.**

**In scope (one container per agent — the issue's stated POC model):**
- Add `bollard = "0.20"` + stream-adapter deps (`tokio-util`, `futures-util`, `async-trait`) to `src-tauri/Cargo.toml`.
- **Reshape `PiIo`**: async trait returning boxed `AsyncRead`/`AsyncWrite` + a transport-tagged teardown handle (host PID vs container id). Keep `HostProcess` green as a pure refactor (proves the seam before Docker enters).
- Hand-written base image `docker/sandbox-base/Dockerfile` with **pinned** Node + Pi; backend `inspect_image` presence check with a clear "build it" error (no silent build).
- `ContainerExec` (bollard): `inspect_image` → `create_container` (`open_stdin: true`, label `pluribus.managed=true`) → `start_container` → `create_exec`/`start_exec` (`attach_stdin/stdout/stderr: true`, **`tty: false`**) → adapt `LogOutput` stream → `AsyncRead` via `tokio_util::io::StreamReader`, box the exec `input` as `AsyncWrite`.
- Deterministic naming `pluribus-sandbox-<thread-id-prefix>`; in-container startup readiness gate (`get_state` round-trips before first prompt); cleanup sequence on session end (`abort → await agent_end → stop t:10 → remove force,v`); transport-aware `pi_stop`.
- Orphan **container** recovery on app start + teardown of all containers on window close (TS `kill_pid` cannot stop containers).
- API key reaches the container via the **exec `env`** (never baked into the image).
- An **integration test** asserting a JSONL command round-trips through `docker exec` stdin→stdout (`#[ignore]`d in CI — no Docker daemon — runnable locally).

**Out of scope (explicitly deferred):**
- Per-agent **Clone** + bind-mount (#19), post-run diff (#21), steer UI (#20).
- **Shared-container / multi-exec** routing (issue defers it; we do one container per agent for true isolation).
- Provisioning / constrained author loop (ADR 0004) — image is hand-written and pinned, no build loop.
- Host-proxy secret hardening (ADR 0002 defers it — key still travels in exec env for the POC).
- The host-bridge cleanup bugs tracked separately in **#25** (lock-across-`await` deadlock), **#26** (orphan pi processes), **#27** (shared event-pump / key map). This plan must not *worsen* #25 (see §7), but does not fix them.

## 2. Architecture

The only structural change versus #17 is the transport seam. Everything above `PiIo` is untouched.

```
 assistant-ui Thread ─► orchestrated-adapter ─► pi-provider.ts (UNCHANGED)
        │ invoke("pi_start_session"/"pi_prompt"/"pi_abort"/"pi_stop") ; listen("pi:event")
        ▼  Tauri IPC
 ┌──────────────── src-tauri/src/pi/ ─────────────────────────────────────────┐
 │ commands.rs   State<Mutex<HashMap<session_id, PiService>>>  (UNCHANGED API) │
 │   pi_start_session picks transport: HostProcess | ContainerExec             │
 │        ▼                                                                    │
 │ service.rs   start(.., io: &dyn PiIo)   ◄── reader/writer/supervisor UNCHANGED
 │   let PiTransport { stdout, stdin, handle } = io.spawn(..).await?;          │
 │   • BufReader::new(stdout).lines()    ← stdout: Box<dyn AsyncRead>          │
 │   • stdin.write_all + b"\n" + flush   ← stdin:  Box<dyn AsyncWrite>         │
 │   • supervisor: handle.wait().await   ← PiHandle::{Host(child)|Container{…}}│
 │        ▲ trait seam (io.rs) — THIS is the reshaped surface                  │
 │   ┌────┴─────────────────────────┬──────────────────────────────────────┐  │
 │   │ HostProcess (refactor)       │ ContainerExec (NEW, bollard)          │  │
 │   │  tokio child → boxed pipes   │  inspect_image → create_container     │  │
 │   │  PiHandle::Host(Child)       │  (open_stdin) → start → create_exec   │  │
 │   │                              │  → start_exec(tty:false) →            │  │
 │   │                              │  StartExecResults::Attached{output,   │  │
 │   │                              │    input}                             │  │
 │   │                              │  output(LogOutput stream)             │  │
 │   │                              │    └►filter StdOut►StreamReader►AsyncRead
 │   │                              │  input ► Box<dyn AsyncWrite>          │  │
 │   │                              │  PiHandle::Container{docker,cid,eid}  │  │
 │   └──────────────────────────────┴──────────────────────────────────────┘  │
 └─────────────────────────────────────────────────────────────────────────────┘
                  docker exec (env: OPENROUTER_API_KEY)  pi --mode rpc --provider <p> --model <m>
                  inside container `pluribus-sandbox-<tid>` from image pluribus-pi-sandbox:<pin>
```

### 2.1 The seam reshape (central design decision)

`service.rs` consumes the #17 spawn result three ways: `stdout` → `BufReader::lines()` (needs `AsyncRead`), `stdin` → `write_all` (needs `AsyncWrite`), `child` → `child.wait()` + `child.id()`. A `docker exec` has **no `Child` and no host PID**, and its stdout is a bollard `LogOutput` *stream*, not a `ChildStdout`. So `PiIo` must return **trait objects**, not concrete tokio types, and a transport-tagged handle for liveness/teardown:

```rust
#[async_trait::async_trait]
pub trait PiIo: Send + Sync {
    async fn spawn(&self, provider: &str, model: &str, key_name: &str, api_key: &str)
        -> Result<PiTransport, String>;
}

pub struct PiTransport {
    pub stdout: Box<dyn tokio::io::AsyncRead  + Unpin + Send>,
    pub stdin:  Box<dyn tokio::io::AsyncWrite + Unpin + Send>,
    pub handle: PiHandle,
}

pub enum PiHandle {
    Host(tokio::process::Child),
    Container { docker: bollard::Docker, container_id: String, exec_id: String },
}

impl PiHandle {
    /// Supervisor: block until the process/exec exits; return its code.
    /// Host  → child.wait().code()
    /// Container → inspect_exec poll until running:false → ExitCode
    pub async fn wait(&mut self) -> Option<i32> { /* … */ }

    /// PID for the host safety-net kill; None for containers.
    pub fn pid(&self) -> Option<u32> { /* Host→child.id(); Container→None */ }

    /// Session-end teardown. Host → no-op (drop EOFs stdin; pi_stop kills pid).
    /// Container → stop_container(t:10) then remove_container(force,v).
    pub async fn teardown(&self) { /* … */ }
}
```

`service.rs::start` changes only at the destructuring line (`let PiTransport { stdout, stdin, mut handle } = io.spawn(..).await?;`) and the supervisor (`handle.wait().await` instead of `child.wait().await`). The reader loop, the `extension_ui_request` auto-cancel, the LF-JSONL writer, and `PiEvent` emission are byte-identical. `PiService` stores `handle` (for teardown) and `pid: Option<u32>`.

### 2.2 `LogOutput` stream → `AsyncRead`

bollard 0.20 `start_exec(&id, None)` → `StartExecResults::Attached { output, input }`. `output: impl Stream<Item = Result<LogOutput, bollard::errors::Error>>`; with `tty:false`, frames are multiplexed `LogOutput::StdOut{message: Bytes}` / `StdErr{…}`. Adapt:

```rust
use futures_util::StreamExt;
use tokio_util::io::StreamReader;
let byte_stream = output.filter_map(|frame| async move {
    match frame {
        Ok(bollard::container::LogOutput::StdOut { message }) => Some(Ok(message)), // Bytes
        Ok(_) => None,                                   // drop StdErr/Console — would corrupt NDJSON
        Err(e) => Some(Err(std::io::Error::new(std::io::ErrorKind::Other, e))),
    }
});
let stdout: Box<dyn AsyncRead + Unpin + Send> = Box::new(StreamReader::new(byte_stream));
```

`StreamReader` turns a `Stream<Item=io::Result<Bytes>>` into `AsyncRead`; `BufReader::lines()` then splits on `\n` exactly as on the host (ADR 0005 LF-only framing is preserved — `lines()` only splits on `\n`). The exec `input` (`Pin<Box<dyn AsyncWrite + Send>>`) is boxed directly as the stdin half.

## 3. Task breakdown

Each task is independently committable and keeps CI green (`cargo check --all-targets` for Rust, `bun run build` for any TS). The reshape is sequenced so `HostProcess` stays working at every step.

---

### Task 1 — deps: bollard + stream adapters

**Files:** `src-tauri/Cargo.toml`.

```toml
bollard      = "0.20"
tokio-util   = { version = "0.7", features = ["io"] }   # StreamReader
futures-util = "0.3"                                    # StreamExt / filter_map
async-trait  = "0.1"                                    # dyn-compatible async PiIo
```
(`bytes` arrives transitively via bollard; `LogOutput::*.message` is already `bytes::Bytes`.)

**Verify:** rust — `cargo check` (deps resolve; nothing references them yet).

---

### Task 2 — reshape `PiIo` to async + boxed transport (HostProcess refactor, NO behavior change)

**Files:** `src-tauri/src/pi/io.rs`, `src-tauri/src/pi/service.rs`.

- Introduce `PiTransport`, `PiHandle` (§2.1). Make `PiIo` an `#[async_trait]` returning `Result<PiTransport, String>`.
- Rewrite `HostProcess::spawn` to build the tokio child as today, then `Box::new(stdout)`, `Box::new(stdin)`, `PiHandle::Host(child)`. Implement `PiHandle::Host` arms of `wait`/`pid`/`teardown`.
- Update `service.rs`: destructure `PiTransport`; supervisor calls `handle.wait().await`; store `handle` + `pid` in `PiService`. **Leave the `ContainerExec` stub returning `Err` for now** (still compiles under the new signature).

This is a **pure refactor** — host behavior is identical. It is the riskiest mechanical change, so it lands first and alone, gated by CI, before any Docker code exists.

**Verify:** rust — `cargo check --all-targets`. (Smoke parity: host Pi path still streams — confirmed in the §6 manual smoke.)

---

### Task 3 — layered base image `docker/sandbox-base/` (Node-for-Pi base + composable toolchain overlays)

**Files:** create `docker/sandbox-base/Dockerfile`, `docker/sandbox-base/README.md`.

**Why Node is in the image (and why that's not the whole story):** `pi` is `@mariozechner/pi-coding-agent`, an **npm package** — Node is the runtime Pi *itself* needs to run, NOT a requirement of the stdio piping (JSONL over stdin/stdout is language-agnostic). The language the **agent works in** on a target repo (Python, Rust, Go, …) is a *separate* concern and varies per project. So the image is designed as a **constant Pi base** plus **composable, per-project toolchain layers** — never a monolithic "always Node-only" image.

Multi-stage / build-arg structure so toolchains are opt-in per project:

```dockerfile
# syntax=docker/dockerfile:1

# --- Stage `pi-base`: the constant — Node solely as Pi's runtime + Pi pinned. ---
FROM node:22-bookworm-slim AS pi-base
# Prefer a digest pin (FROM node@sha256:…) at implementation for reproducibility.
RUN npm install -g @mariozechner/pi-coding-agent@0.73.1
ENTRYPOINT ["sleep", "infinity"]   # no-op host; Pi launched per-session via `docker exec`

# --- Composable toolchain layers (opt-in via build args). #18 builds `pi-base` only. ---
FROM pi-base AS with-python
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip && rm -rf /var/lib/apt/lists/*

FROM pi-base AS with-go
RUN apt-get update && apt-get install -y --no-install-recommends golang && rm -rf /var/lib/apt/lists/*

# Future: with-rust, with-node-dev, etc. Compose what a given project needs.
```

- **#18 POC builds only the `pi-base` target** — image tag (constant in Rust): `pluribus-pi-sandbox:base`. The overlay stages are scaffolding for the per-project image pipeline (a later issue picks the right target per repo).
- `README.md` documents: base build `docker build --target pi-base -t pluribus-pi-sandbox:base docker/sandbox-base`, and how to add a toolchain (`--target with-python -t pluribus-pi-sandbox:python`). Note this is the seam for a future build-pipeline / Compose-driven image matrix.
- No backend build loop (ADR 0004 deferred) — the backend only **checks** presence of the selected tag (Task 5).
- **Pin note:** local Pi is `0.73.1` (ADR 0005 was verified against `0.67.68`); pin to a version confirmed against the RPC protocol at implementation, and pin Node to a digest.

**Verify:** none in CI (no Docker). Locally (Task = Phase 1 validation): `docker build --target pi-base …` succeeds; `docker run --rm pluribus-pi-sandbox:base pi --version` prints the pinned version; raw `docker exec` JSONL round-trip holds (proves `open_stdin`/`tty:false`/LF framing before any Rust).

---

### Task 4 — `ContainerExec` transport (bollard create/start/exec + stream adaptation)

**Files:** `src-tauri/src/pi/io.rs` (or split into `pi/container.rs`).

`ContainerExec { image_tag, container_name }`. `spawn`:
1. `Docker::connect_with_socket_defaults()` → on error, `Err("Docker not reachable: …")`.
2. `docker.inspect_image(&image_tag)` → on 404 (`DockerResponseServerError`), `Err("base image '{tag}' not found — build it: docker build -t {tag} docker/sandbox-base")`. **No silent build.**
3. Best-effort remove a stale container of the same name (idempotent restart).
4. `create_container(name=container_name, ContainerCreateBody { image, open_stdin: Some(true), labels: {"pluribus.managed":"true","pluribus.session": session}, cmd: sleep infinity (from ENTRYPOINT), ..})` → `start_container`.
5. `create_exec(container, CreateExecOptions { cmd: ["pi","--mode","rpc","--provider",p,"--model",m], env: ["{key_name}={api_key}"], attach_stdin:true, attach_stdout:true, attach_stderr:true, tty: Some(false), ..})`.
6. `start_exec(&exec.id, None)` → `StartExecResults::Attached { output, input }`; adapt `output`→`AsyncRead` (§2.2), box `input`.
7. Return `PiTransport { stdout, stdin, handle: PiHandle::Container { docker, container_id, exec_id } }`.

Implement `PiHandle::Container` arms: `wait` = poll `inspect_exec` until `running == Some(false)`, return `exit_code`; `pid` = `None`; `teardown` = `stop_container(t:10)` then `remove_container(force,v)`.

**Verify:** rust — `cargo check --all-targets`.

---

### Task 5 — transport selection + readiness gate in `commands.rs`

**Files:** `src-tauri/src/pi/commands.rs` (+ a small `global_settings` read).

- `pi_start_session` chooses transport: read `global_settings.pi_sandbox` (`"container"` default for #18, `"host"` for dev fallback). Container name = `format!("pluribus-sandbox-{}", &session_id[..session_id.len().min(12)])`. Build `ContainerExec` or `HostProcess` accordingly and pass `&dyn PiIo` to `PiService::start` (signature unchanged).
- **Readiness gate (startup race):** `start_exec` returns before Pi is listening. After `start`, send `get_state` and await the matching `{type:"response",command:"get_state"}` (or first agent line) via a `ready` oneshot with a ~10 s timeout; on timeout, teardown + `Err("pi did not become ready in container")`. Requires `service.rs` to resolve a `ready` oneshot on the first `response` (small, additive; host path resolves it instantly).
- **`pi_stop` becomes transport-aware:** remove from map → `svc.handle.teardown().await` (container: abort already sent by drop/EOF; explicit `stop`+`remove`). Host arm keeps the `kill_pid` safety net via `svc.pid()`.
- **Avoid #25 regression:** do **not** hold the `PiState` map lock across any `bollard` `.await` (image inspect, create, start, exec, stop, remove) or across `stdin send().await`. Clone/extract what you need, drop the guard, then await.

**Verify:** rust — `cargo check --all-targets`.

---

### Task 6 — orphan recovery on start + teardown-all on window close

**Files:** `src-tauri/src/lib.rs` (`setup` + `on_window_event`/exit), maybe `pi/commands.rs` helper.

- **Startup reconcile:** on `setup`, `list_containers(filters: label=pluribus.managed=true)` and `force`-remove each (POC: nuke all managed containers from prior runs — TS `kill_pid` can't, and the `agents` table from migration 010 records what *should* be reaped). Best-effort; log failures.
- **Window close / app exit:** add `on_window_event(CloseRequested)` (or `RunEvent::ExitRequested`) that drains the `PiState` map and `teardown()`s every session so no container is orphaned. Mirrors the no-orphans acceptance criterion from #17, extended to containers.

**Verify:** rust — `cargo check --all-targets`; manual smoke (§6) confirms `docker ps` is clean after app close and after a restart.

---

### Task 7 — integration test: JSONL round-trip through `docker exec`

**Files:** `src-tauri/tests/pi_container_roundtrip.rs` (or `#[cfg(test)]` in `container.rs`).

`#[tokio::test] #[ignore]` (CI has no Docker daemon, so it must compile under `cargo check --all-targets` but not run): create a container from the base image, `create_exec`/`start_exec` a `cat` with `tty:false` + `open_stdin`, write `{"type":"ping"}\n` to `input`, read it back from the adapted `AsyncRead`, assert the line round-trips byte-for-byte (proves `open_stdin`/`attach_stdin`/`tty:false`/LF framing all hold). Teardown in a `Drop`/finally. Document `cargo test -- --ignored pi_container` as the local gate.

**Verify:** rust — `cargo check --all-targets` (test compiles). Local: `cargo test -- --ignored` passes with Docker running.

---

### Task 8 — docs: CONTEXT.md / ADR note (Settings toggle DEFERRED)

**Files:** `CONTEXT.md` (or `docs/adr/`). **No frontend changes.**

- Note the container transport, the `pi_sandbox` default (`container`, dev-overridable via the DB row), the layered base-image design (Node-for-Pi base + composable toolchain overlays), the base-image build step, and that shared-container/clone/diff are deferred (#19/#21).
- **Settings UI toggle is deferred** (per user direction) — `pi_sandbox` defaults to `container` and is set via the `global_settings` DB row for now; no `settings-overlay.tsx` change in #18.

**Verify:** docs-only (no CI gate). Confirm no stray frontend diff.

## 4. Seam / lifecycle mapping table

| Concern | Host (#17, unchanged) | Container (#18, new) |
|---|---|---|
| spawn | tokio `Command::new("pi")` | `inspect_image` → `create_container(open_stdin)` → `start` → `create_exec` → `start_exec(tty:false)` |
| stdout | `ChildStdout` → boxed `AsyncRead` | `LogOutput` stream → filter `StdOut` → `StreamReader` → boxed `AsyncRead` |
| stdin | `ChildStdin` → boxed `AsyncWrite` | exec `input` `Box<dyn AsyncWrite>` |
| reader loop | `BufReader::lines()` + parse `{type}` | **identical** |
| `wait` (supervisor) | `child.wait().code()` | poll `inspect_exec` until `running:false` → `exit_code` |
| `pid` | `child.id()` | `None` |
| key delivery | child `.env(key_name, key)` | exec `env: ["{key_name}={key}"]` (never in image) |
| readiness | immediate | `get_state` round-trip gate (~10 s timeout) before first prompt |
| `pi_abort` | `{type:"abort"}` on stdin | **identical** |
| `pi_stop` / session end | drop (EOF) + `kill_pid` safety net | `teardown`: abort→await `agent_end`→`stop(t:10)`→`remove(force,v)` |
| orphan recovery | TS `cleanupOrphans` / `kill_pid` | startup `list_containers(label)` + force-remove; window-close teardown-all |
| naming | PID | `pluribus-sandbox-<thread-id-prefix>` (label `pluribus.managed=true`) |

## 5. Acceptance criteria

From the issue + gap report §3:

- [ ] **bollard integrated** — image-present check (`inspect_image`), run container, exec, stop/remove. _Verify:_ `cargo check --all-targets`; Task 7 round-trip locally.
- [ ] **Layered base image builds & runs** — `docker/sandbox-base/Dockerfile` `pi-base` target, pinned Node + Pi; toolchain overlay stages scaffolded. _Verify:_ `docker build --target pi-base` + `docker run … pi --version`.
- [ ] **`pi --mode rpc` driven over `docker exec`, same stream path** — `ContainerExec` feeds the unchanged reader/writer via the reshaped seam. _Verify:_ code review (seam) + smoke.
- [ ] **UI prompt → streaming response from Pi inside the container** — verifiable via `docker ps` showing `pluribus-sandbox-*`. _Verify:_ manual smoke with Docker + OpenRouter key.
- [ ] **Container stopped/removed cleanly on session end** — `teardown` sequence; nothing left in `docker ps -a`. _Verify:_ smoke.
- [ ] **`open_stdin:true` + `attach_stdin/out/err` + `tty:false`** — else stdin drops / PTY corrupts NDJSON. _Verify:_ Task 7 round-trip (fails without these).
- [ ] **Orphan container recovery on restart** — startup reconcile by label; window-close teardown-all. _Verify:_ smoke (kill app mid-run; relaunch; `docker ps -a` clean).
- [ ] **Deterministic naming** `pluribus-sandbox-<thread-id-prefix>`. _Verify:_ code review + `docker ps`.
- [ ] **API key reaches container via exec env, not image** — `docker history` shows no key; run succeeds. _Verify:_ code review + smoke.
- [ ] **In-container startup confirmation** — `get_state` returns before first prompt (readiness gate). _Verify:_ smoke (no first-prompt hang).
- [ ] **No host-bridge regression** — `HostProcess` still streams after the seam reshape. _Verify:_ smoke with `pi_sandbox=host`.

## 6. Verification strategy

Same constraint as #17 — no local Rust/bun toolchain in CI, and **CI has no Docker daemon**, so container behavior is human-smoke-only:

1. **Push `feat/18-pi-sandbox-bollard`**, open a draft PR → CI runs.
2. **Gating CI steps:** `cargo check --all-targets` (gates Tasks 1–7, incl. the `#[ignore]`d test compiling) and `bun run build` (only if Task 8 touches Settings). `cargo fmt`/`clippy` advisory.
3. **Manual smoke (requires Docker + `pi` image + `OPENROUTER_API_KEY`):**
   - `docker build --target pi-base -t pluribus-pi-sandbox:base docker/sandbox-base`.
   - `cargo tauri dev`; select DeepSeek V4 Flash (Pi); send a prompt.
   - In another terminal `docker ps` → a `pluribus-sandbox-*` container is **Up**; reasoning + text stream live in chat; turn completes on `agent_end`.
   - Ask Pi to write a file; confirm it lands **inside** the container (`docker exec <name> ls`), not on the host.
   - Abort mid-turn → prompt cancels, thread still usable, container still Up.
   - End session / close app → `docker ps -a` shows the container stopped+removed.
   - Kill the app mid-run, relaunch → startup reconcile removes the orphan (`docker ps -a` clean).
   - Set `pi_sandbox=host`, repeat the first prompt → host path still streams (no regression).
   - Run the round-trip integration test: `cd src-tauri && cargo test -- --ignored pi_container`.

## 7. Risks & open questions

- **Seam reshape touches the one file #17 called "most complex."** Mitigation: Task 2 is a pure host-only refactor landed and CI-gated *before* any Docker code; behavior parity confirmed by the host smoke. The `service.rs` diff is intentionally tiny (destructure + supervisor line).
- **#25 (lock-across-`await`) is easy to worsen.** bollard calls are slow and numerous; holding the `PiState` mutex across them would serialize all sessions and risk the documented deadlock. **Rule (Task 5):** never `.await` a bollard/stdin op under the map lock. Out of scope to *fix* #25, but in scope to not regress it.
- **`async_trait` boxing overhead** on `spawn` is negligible (called once per session). Native `async fn in trait` isn't dyn-compatible yet for `&dyn PiIo`, so `#[async_trait]` is the pragmatic choice.
- **Startup race / readiness:** `start_exec` returns before Pi binds stdin. The `get_state` gate with timeout is the mitigation; needs the additive `ready` oneshot in `service.rs`. Open: exact readiness signal — prefer the `get_state` `response`; fall back to "first agent line within N s."
- **`inspect_exec` exit-code latency** for the supervisor `wait` — poll interval ~250 ms is fine for cleanup; we don't need sub-ms exit detection.
- **Transport selection UX:** plan defaults `pi_sandbox=container` via `global_settings`, DB-overridable. **Settings toggle DEFERRED** (user direction) — revisit only if smoke shows we flip often.
- **Image is layered, not monolithic:** Node is in the base only because Pi is a Node app; agent-workspace toolchains (Python/Rust/Go) are composable overlay stages, built per-project by a future image pipeline. #18 builds the `pi-base` target only.
- **Node/Pi pin exactness:** Dockerfile shows `node:22-bookworm-slim`; recommend pinning to a **digest** at implementation. Pi pin: local is `0.73.1`, ADR 0005 verified `0.67.68` — pin to a version re-confirmed against the RPC protocol during Phase 1 validation.
- **Image distribution:** POC requires a manual `docker build`; no registry push. Documented in the base-image README and PR smoke steps.

**Explicit non-goals (deferred):** Clone + bind-mount (#19), post-run diff (#21), steer UI (#20), shared-container multi-exec, provisioning loop (ADR 0004), host-proxy secret hardening (ADR 0002), and the host-bridge cleanups (#25/#26/#27).

## 8. Suggested commit sequence & PR

**Branch:** `feat/18-pi-sandbox-bollard`

**Atomic commits (each keeps CI green):**
1. `build(pi): add bollard + tokio-util/futures-util/async-trait deps` (Task 1)
2. `refactor(pi): reshape PiIo seam to async boxed transport + PiHandle (host parity)` (Task 2)
3. `feat(docker): add pinned Node+Pi sandbox base image` (Task 3)
4. `feat(pi): implement ContainerExec transport via bollard docker exec` (Task 4)
5. `feat(pi): select transport + in-container readiness gate + transport-aware pi_stop` (Task 5)
6. `feat(pi): orphan container recovery on start + teardown-all on window close` (Task 6)
7. `test(pi): docker exec JSONL round-trip integration test (ignored in CI)` (Task 7)
8. `docs(pi): document container transport + optional Settings toggle` (Task 8)

**PR title:** `feat: run Pi inside a sandbox container via docker exec (#18)`

**PR body outline:**
- **Summary** — Pi now runs in a per-agent Docker container driven over `docker exec` (bollard); chat unchanged; closes #18, realizes ADR 0002's sandbox boundary.
- **Architecture** — link §2 diagram; emphasize the seam reshape (boxed `AsyncRead`/`AsyncWrite` + `PiHandle`) and that `service.rs` reader/writer + the entire frontend are unchanged.
- **De-risking** — Task 2 host-parity refactor first; #25 non-regression rule; `#[ignore]`d round-trip test.
- **Out of scope** — #19/#20/#21, shared-container, provisioning, secret hardening, #25–#27.
- **Verification** — CI green; attach the §6 Docker smoke checklist for a maintainer with Docker + OpenRouter key.
- Footer:
  ```
  🤖 Generated with [Claude Code](https://claude.com/claude-code)
  ```
