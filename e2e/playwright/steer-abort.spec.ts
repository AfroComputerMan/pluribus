import { test, expect } from "@playwright/test";
import { TAURI_MOCK } from "./tauri-mock.js";

// Demo recording for #20: the steer side-channel + abort, both gated on the
// Rust-authoritative `agent_running` flag. The real pi-provider runs; only the
// Tauri IPC boundary is mocked (TAURI_MOCK), so a run "stays in flight" exactly
// as it does in production until we abort it.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(TAURI_MOCK);
});

test("steer (queued) + abort while the agent is running", async ({ page }) => {
  await page.goto("/");

  // Open the seeded thread; its Pi model (DeepSeek V4 Flash) makes steer relevant.
  await page.getByText("Steer + abort demo").first().click();
  const composer = page.getByLabel("Message input");
  await expect(composer).toBeVisible();

  // At rest, neither run-state-gated control exists.
  await expect(page.getByLabel("Steer the running agent")).toHaveCount(0);
  await expect(page.getByLabel("Stop generating")).toHaveCount(0);

  // Start a run.
  await composer.fill("List the Rust files in this repo and summarise the project.");
  await page.waitForTimeout(800);
  await page.getByLabel("Send message").click();

  // The agent is now genuinely running → both gated controls mount.
  const steer = page.getByLabel("Steer the running agent");
  await expect(steer).toBeVisible({ timeout: 20_000 });
  await expect(page.getByLabel("Stop generating")).toBeVisible();
  await page.waitForTimeout(1200);

  // Queue a steer — applied at the next step, not a mid-token interrupt.
  await steer.fill("Actually, focus only on the Rust files.");
  await page.waitForTimeout(700);
  await page.getByLabel("Send steer").click();

  // The transient notice confirms the queued semantics, and the input clears.
  // ("Steered" is unique to the <p> notice — the tooltip says "Steer (applies…)".)
  await expect(page.getByText("Steered — applies at the next step")).toBeVisible({ timeout: 8_000 });
  await expect(steer).toHaveValue("");
  await page.waitForTimeout(1800);

  // Abort: both gated controls disappear and Send returns.
  await page.getByLabel("Stop generating").click();
  await expect(steer).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByLabel("Send message")).toBeVisible();
  await page.waitForTimeout(1000);
});
