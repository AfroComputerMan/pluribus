# Browser demo recorder (Playwright + mocked Tauri IPC)

The **agent-runnable** path for PR videos. Unlike the `tauri-driver` harness in
`../` (full backend fidelity, needs Rust + Bun + a built app), this runs the
**real frontend** in plain Chromium against a **mocked Tauri IPC boundary**, so
it needs only Node + Playwright — no toolchain.

```bash
npm install
npm run e2e:web:install      # one-time: fetch the Chromium build
npm run e2e:web              # runs the specs, records webm under artifacts/
```

Output: `e2e/playwright/artifacts/<test>/video.webm`. Curated demos worth keeping
live in `demos/` (committed); raw `artifacts/` are gitignored.

## How it works

`tauri-mock.js` is injected with `page.addInitScript` **before** app code runs and
implements the slice of `window.__TAURI_INTERNALS__` the frontend touches:

- **Boot:** `metadata` (so `getCurrentWindow()` doesn't throw), `plugin:sql|*`
  (PRAGMA → WAL; seeded workspace + one Pi-model thread; everything else empty),
  `plugin:path|*`.
- **Feature (#20):** `pi_agent_running` reflects a client-side `running` flag;
  `pi_prompt`/`pi_start_session` flip it true; `pi_abort` flips it false.

What makes this **faithful rather than fake UI**: the real `Thread`, the real
`pi-provider.run()`, the real `SteerControl`, and the real assistant-ui runtime all
execute. A run "stays in flight" because `pi-provider` genuinely awaits a `pi:event`
that never arrives (its real mid-run behaviour); abort genuinely pushes `_done` to
end it. Only the OS syscall boundary is mocked.

## Honest scope

This proves the **frontend feature** (the control renders, gates on `agent_running`,
queues, the notice shows, abort tears it down). It does **not** exercise the Rust
backend — that is the `tauri-driver` harness (`../README.md`), which needs the
toolchain and runs in the `e2e`-labelled CI job.

## Adding a demo

Add a `*.spec.ts` next to `steer-abort.spec.ts`; selectors are the components'
`aria-label`s. If a feature needs more of the IPC surface, extend `tauri-mock.js`
(unknown commands already return a harmless `null`, logged to `window.__demo.invokeLog`).
