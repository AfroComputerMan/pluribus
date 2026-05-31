# End-to-end tests + PR videos

**Repo rule:** every PR ships a short video demonstrating the fix or feature.
This harness produces that video by driving the **built** Tauri app and
screen-recording the run.

## Why not Playwright?

Pluribus' UI runs in Tauri's native **webkit2gtk** webview and talks to Rust
through `invoke()`. Playwright can only drive a real browser pointed at the Vite
dev server, where `window.__TAURI__` is absent — so `invoke()` throws and nothing
the app actually does (SQLite, Pi/Codex process control, sessions) can be
exercised. We use **[`tauri-driver`](https://v2.tauri.app/develop/tests/webdriver/)**
+ **WebdriverIO**, which wrap the platform's native WebDriver (`WebKitWebDriver`
on Linux) and drive the real app, IPC and all.

Video is captured at the OS level with **ffmpeg** (see `record.sh`) because
`WebKitWebDriver` has no reliable screenshot endpoint for frame-stitching
reporters.

## Prerequisites (Linux)

```bash
# native WebDriver backend for tauri-driver
sudo apt-get install -y webkit2gtk-driver ffmpeg
which WebKitWebDriver        # must resolve

# the driver wrapper (installs to ~/.cargo/bin/tauri-driver)
cargo install tauri-driver --locked
```

You also need the normal Tauri toolchain (Rust + Bun) and the Tauri v2 system
deps from <https://v2.tauri.app/start/prerequisites>.

> macOS/Windows: tauri-driver supports them too (WKWebView / msedgedriver), but
> `record.sh` is X11-only. On those platforms record with the OS screen recorder
> or adapt the capture command.

## Running

```bash
bun install
bun run e2e:build      # tauri build --debug --no-bundle  -> src-tauri/target/debug/pluribus
bun run e2e            # run the specs (no recording)
bun run e2e:record     # run the specs AND record -> e2e/artifacts/pluribus-e2e.mp4
```

Headless (no monitor):

```bash
xvfb-run -a -s "-screen 0 1280x800x24" bun run e2e:record
```

## Attaching the video to a PR

GitHub only ingests media through the web UI (it uploads to its CDN); `gh`/the
REST API cannot upload a video to a comment. Two supported paths:

1. **CI artifact (default):** the `E2E` workflow records the run and uploads
   `pluribus-e2e-video`. Add the **`e2e`** label to a PR (or trigger the workflow
   manually) to run it, then download the artifact and **drag the `.mp4` into the
   PR description / a comment** — GitHub hosts it inline.
2. **Local:** run `bun run e2e:record` and drag `e2e/artifacts/pluribus-e2e.mp4`
   into the PR.

## Writing a feature spec

`specs/smoke.e2e.js` only proves the app boots. For a feature PR, add a spec that
*drives the changed surface* so the video shows it working. Selectors are the
`aria-label`s already on the components (e.g. `Message input`, `Select model`,
`Steer the running agent`, `Stop generating`).

```js
// specs/steer.e2e.js — example: demonstrate the #20 steer control
describe("steer control", () => {
  it("queues a steer mid-run", async () => {
    const composer = await $('[aria-label="Message input"]');
    await composer.waitForDisplayed({ timeout: 60000 });
    await composer.setValue("write a haiku about the sea");
    await $('[aria-label="Send message"]').click();

    // While the agent runs, the steer input appears (gated on agent_running).
    const steer = await $('[aria-label="Steer the running agent"]');
    await steer.waitForDisplayed({ timeout: 30000 });
    await steer.setValue("make it about mountains instead");
    await $('[aria-label="Send steer"]').click();
    // …assert the queued-steer affordance, then let the turn finish.
  });
});
```

Keep specs deterministic; the artifact is the proof, so favour a clear,
watchable flow over exhaustive assertions.
