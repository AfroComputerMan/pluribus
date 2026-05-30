
# Issue #20 — Real-time control: steer + abort — Scope & Plan

## 1. Goal & scope

Wire Pi's real-time intervention controls into the chat UI per the agreed control model (observe + **steer** + **abort**; **no per-tool approval** — the sandbox is the safety boundary, ADR 0002). The user can nudge a running agent mid-run (steer) and stop it promptly (abort), with controls enabled **only while the agent is actively running**.

**Reality check — abort is already done (#17).** `PiService::abort()` → `{type:"abort"}`, the `pi_abort` command, and the provider's `onAbort`/`interrupt` wired to assistant-ui's `abortSignal` all exist and were exercised in #18/#19 smoke. So #20's abort work is mostly **confirming the stop control is visible + enabled while running** and that `agent_end` (which precedes the abort ack, ~6 ms) cleanly terminates the turn. **The new work is steer**, plus Rust-authoritative run-state gating and `queue_update` surfacing.

**In scope:**
- Rust `PiService::steer(message)` → `{type:"steer", message}` (verified shape) + `pi_steer_agent({threadId, message})` command.
- A **`queue_update`** PiEvent variant + reader case (verified event) so the UI can show "steer queued — applies at the next step."
- **Rust-authoritative agent run-state**: a per-session flag (true between `agent_start`/`turn_start` and `agent_end`/exit) exposed to the UI, used to gate both controls — **not** `thread.isRunning`.
- UI: a **steer input** (text + send) shown only while running; the **abort/stop** control (assistant-ui `Cancel`) enabled while running; honest copy ("applies at next step"); surface `queue_update`.
- Steer message escaping: passed as a command param and serialized by `serde_json` Rust-side, so LF-framing is preserved automatically (no raw newline can leak into stdin).

**Out of scope / explicit NON-GOALS:**
- **`follow_up`** (queue a message for after the run) — non-goal; steer covers mid-run guidance.
- **Mid-run `set_model` / `cycle_model` / thinking-level** — `set_model` exists internally (seed) but is **not** surfaced in #20.
- **Per-tool approval** — explicitly rejected by ADR 0002.
- **Steer dedup / double-steer queue management** — POC allows multiple steers, each queued; no dedup UI.
- **`all` steering mode** (apply mid-token) — POC uses Pi's default `one-at-a-time` (queued at next boundary).

## 2. Architecture

```
 Thread (running) ─┬─ Abort: assistant-ui <Cancel/> → abortSignal → onAbort → invoke("pi_abort")   [EXISTS #17]
                   └─ Steer: <SteerControl/> (text+send, shown iff agent_running)
                              │ onSend(msg)
                              ▼ invoke("pi_steer_agent", { threadId, message: msg })   [NEW]
        │ Tauri IPC
        ▼  src-tauri/src/pi/
 commands.rs  pi_steer_agent → svc.steer(message)            [NEW command]
 service.rs   steer(msg) → send({type:"steer", message})     [NEW method]
              run-state: AtomicBool running, set on agent_start/turn_start,
                         cleared on agent_end / ProcessExit    [NEW]
              reader: "queue_update" → PiEvent::QueueUpdate    [NEW case]
        │ events ("pi:event") + pi_get_state{ agent_running }
        ▼  pi-provider.ts
   steer(threadId,msg): invoke("pi_steer_agent", …)           [NEW provider method / direct invoke]
   on QueueUpdate → transient "steer queued" signal
   agent_running ← from pi_get_state poll OR derived from agent_start..agent_end events
```

**Gating signal.** Add `agent_running: bool` to the `pi_get_state` return (it already returns `{running, pid}` — `running` = session alive; add `agent_running` = mid-turn). The UI enables steer/abort on `agent_running`. (Simpler fallback: assistant-ui run state — but the gap report wants Rust-authoritative, and the flag is cheap: one `Arc<AtomicBool>` flipped in the reader on `agent_start`/`agent_end`.)

**Why steer is out-of-band.** assistant-ui has **no** mid-turn message-injection API. The run() generator is mid-yield; we cannot append a turn through the adapter. So steer is a side-channel `invoke` straight to Rust → Pi stdin, independent of the generator. Its UI visibility is therefore custom (see §3 decision).

## 3. Steer visibility — decision needed

Pi does **not** echo a steer back as a message (unlike `prompt`). So the steered text only appears in the UI if we render it ourselves. Two options:

- **(A) Transient annotation (POC-simple, recommended):** show the steer inline as a small "↪ Steered: <msg> — applies at next step" chip/toast driven by the `queue_update` ack; not persisted as a thread message. Minimal, no fight with the assistant-ui message model.
- **(B) Persisted appended user message** with `metadata.isSteered: true` (gap-report recommendation): nicer history, but injecting a user bubble mid-run is awkward (the generator owns the message list) and risks ordering/persistence bugs.

Recommend **(A)** for the POC; (B) is a follow-up once the message-model interaction is designed.

## 4. Task breakdown

CI gate: `cargo check --all-targets` / `bun run build`. Branch off main after #30 merges.

### Task 1 — Rust: steer command + queue_update event
- `service.rs`: `pub async fn steer(&self, message: String)` → `self.send(json!({"type":"steer","message":message}))`.
- `types.rs`: add `QueueUpdate { session_id }` (and optionally carry a count/desc if `queue_update` payload is useful — confirm shape in validation).
- `service.rs` reader: `"queue_update" => Some(PiEvent::QueueUpdate { session_id })`.
- `commands.rs`: `#[tauri::command] pub async fn pi_steer_agent(state, session_id, message) -> Result<(),String>` (lock → lookup → `svc.steer(message)` → drop; #25 discipline). Register in `lib.rs`. _Verify:_ `cargo check`.

### Task 2 — Rust: authoritative agent-running flag
- `service.rs`: `running: Arc<AtomicBool>`; in the reader set `true` on `agent_start` (and `turn_start`), `false` on `agent_end`; supervisor sets `false` on exit. Add `pub fn agent_running(&self) -> bool`.
- `commands.rs`: extend `pi_get_state` return with `agent_running: svc.agent_running()`. _Verify:_ `cargo check`.

### Task 3 — Provider/TS: steer + queue_update + running
- `pi-provider.ts`: add a `steer(threadId, message)` method (or export a helper) calling `invoke("pi_steer_agent", { sessionId: threadId, message })`. Handle `queue_update` events in the listener → emit a transient signal (callback/event) for the UI. (Message escaping is automatic — Rust serializes.)
- Expose `agent_running` to the UI (a small `pi_get_state` poll while a run is active, or a store updated from `agent_start`/`agent_end` events). _Verify:_ `bun run build`.

### Task 4 — UI: steer control + abort gating
- A `SteerControl` (shadcn `Input` + send button, lucide icon) rendered in the composer/thread area, **visible/enabled only when `agent_running`**. On submit: call steer, clear input, show "↪ steered — applies at next step"; on `queue_update` show "steer queued."
- Ensure the assistant-ui **Cancel/stop** button (abort) is present and enabled while `agent_running` (it already maps to `abortSignal` → `pi_abort`).
- Copy must say steer "takes effect at the next step" (NOT "interrupts now"). _Verify:_ `bun run build`.

### Task 5 — docs (CONTEXT.md)
Control model: observe + steer (queued, next-boundary) + abort (prompt, `agent_end` terminator); no per-tool approval (ADR 0002); steer is out-of-band (assistant-ui has no injection API); gated on Rust-authoritative `agent_running`; follow_up/set_model non-goals. _Verify:_ docs-only.

### Task 6 — local validation (manual, Docker + .env Pi)
Drive a **long** turn in the container (prompt: "write a 500-word essay slowly"), then mid-run `pi_steer_agent` with "stop and just say DONE": confirm (a) a `queue_update` arrives, (b) the essay keeps streaming (NOT a mid-token cut — verifies the queued semantics), (c) the guidance is applied at the next turn/tool boundary. Separately, abort mid-run → `agent_end` within ~tens of ms, thread still usable. Capture the `queue_update` payload shape to finalize Task 1's variant.

## 5. Acceptance criteria

- [ ] Steer control sends `steer` to the running agent; the agent visibly incorporates it (at the next step).
- [ ] Abort control sends `abort`; the agent stops promptly (`agent_end`).
- [ ] Controls enabled **only while the agent is actively running** (Rust-authoritative `agent_running`).
- [ ] Steering mid-run does **not** corrupt the stream/session (queued, out-of-band, JSON-escaped).
- [ ] `queue_update` surfaced as "steer queued — applies at next step" (honest copy).

## 6. Risks & decisions

- **DECIDED (proposed) — steer visibility = transient annotation (A).** Confirm vs persisted message (B).
- **DECIDED — follow_up & mid-run set_model are NON-GOALS** (set_model stays internal).
- **Steer is queued, not a mid-token interrupt** (verified, ADR 0005). The whole UX hinges on honest copy; do not imply instant effect.
- **Rust-authoritative running flag** avoids the `thread.isRunning` edge cases the gap report flags; cheap `AtomicBool`.
- **abort-while-idle:** Pi behavior undefined — the `agent_running` gate prevents firing it when idle.
- **No local cargo/bun** → push→CI; Docker + `.env` for the §6 live steer/abort check.

## 7. Suggested commit sequence & PR

Branch `feat/20-steer-abort`.
1. `feat(pi): add steer command + queue_update event + pi_steer_agent`
2. `feat(pi): track authoritative agent-running state, expose via pi_get_state`
3. `feat(ui): steer control + abort gating on agent_running (queue_update surfaced)`
4. `docs: real-time control model — steer (queued) + abort (CONTEXT.md)`

**PR title:** `feat: real-time steer + abort controls (#20)`
**Verification:** CI green; attach a live log showing a `queue_update` on steer and `agent_end` on abort. Footer:
```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```
