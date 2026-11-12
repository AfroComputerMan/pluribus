// WebdriverIO + tauri-driver config for Pluribus end-to-end tests.
//
// WHY tauri-driver (not Playwright): Pluribus is a Tauri app whose UI runs in
// the native webkit2gtk webview and talks to Rust via `invoke()`. Playwright can
// only drive a real browser pointed at the Vite dev server, where `window.__TAURI__`
// is absent — so every `invoke()` throws and nothing the app actually does can be
// exercised. tauri-driver wraps the platform's native WebDriver (WebKitWebDriver
// on Linux) and drives the built app, IPC and all. See e2e/README.md.
//
// Video is captured at the OS level (ffmpeg over the X display) by e2e/record.sh
// and the e2e CI job — WebKitWebDriver's screenshot support is too limited for
// frame-stitching reporters, so we record the display directly.

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

// The debug binary produced by `tauri build --debug` (productName = "pluribus").
const APP_BINARY = path.resolve(__dirname, "..", "src-tauri", "target", "debug", "pluribus");

// tauri-driver is a `cargo install`ed binary; honour an override for non-default homes.
const TAURI_DRIVER =
  process.env.TAURI_DRIVER_PATH ||
  path.resolve(os.homedir(), ".cargo", "bin", "tauri-driver");

let tauriDriver;

/** Idempotently stop the tauri-driver child (safe to call repeatedly). */
function stopTauriDriver() {
  if (tauriDriver && !tauriDriver.killed) tauriDriver.kill();
  tauriDriver = undefined;
}

// Safety net: afterSession only runs on a clean session lifecycle. If session
// creation fails or the run is interrupted (Ctrl-C / crash) before then, these
// handlers ensure the driver process never outlives this one.
process.once("exit", stopTauriDriver);
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.once(signal, () => {
    stopTauriDriver();
    process.exit(1);
  });
}

export const config = {
  hostname: "127.0.0.1",
  port: 4444, // tauri-driver listens here; it spawns the native driver on 4445.
  specs: ["./specs/**/*.e2e.js"],
  maxInstances: 1,
  capabilities: [
    {
      maxInstances: 1,
      "tauri:options": {
        application: APP_BINARY,
      },
    },
  ],
  reporters: ["spec"],
  framework: "mocha",
  mochaOpts: {
    ui: "bdd",
    timeout: 120000, // first paint includes SQLite migrations + adapter wiring.
  },

  // Fail fast with an actionable message instead of a cryptic driver error when
  // the app hasn't been built yet. We deliberately do NOT rebuild here — CI and
  // `bun run e2e:build` own that step so the build is logged and cached.
  onPrepare: () => {
    if (!fs.existsSync(APP_BINARY)) {
      throw new Error(
        `Tauri debug binary not found at ${APP_BINARY}\n` +
          `Build it first:  bun run e2e:build   (tauri build --debug --no-bundle)`
      );
    }
    if (!fs.existsSync(TAURI_DRIVER)) {
      throw new Error(
        `tauri-driver not found at ${TAURI_DRIVER}\n` +
          `Install it:  cargo install tauri-driver --locked   (or set TAURI_DRIVER_PATH)`
      );
    }
  },

  beforeSession: () => {
    tauriDriver = spawn(TAURI_DRIVER, [], {
      stdio: [null, process.stdout, process.stderr],
    });
  },

  afterSession: stopTauriDriver,
};
