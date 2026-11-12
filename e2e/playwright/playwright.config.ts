import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

// Browser-based demo recorder: runs the REAL frontend in Chromium against a
// mocked Tauri IPC boundary (see tauri-mock.js) and records video. This is the
// path the agent can run WITHOUT the Rust/Bun toolchain — it proves the UI/
// feature, not the Rust backend (that is the tauri-driver harness in ../).
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  timeout: 90_000,
  workers: 1,
  reporter: "line",
  outputDir: "./artifacts",
  use: {
    baseURL: "http://localhost:1420",
    viewport: { width: 1280, height: 800 },
    video: "on", // every test records a webm under ./artifacts
  },
  // Auto-start the Vite dev server (reused if one is already running on :1420).
  webServer: {
    // Concrete bin path — `vite` is not on PATH in CI (only node_modules/.bin).
    command: "node_modules/.bin/vite --port 1420 --strictPort",
    cwd: repoRoot,
    url: "http://localhost:1420",
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
