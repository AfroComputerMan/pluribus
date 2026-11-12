import { test, expect } from "@playwright/test";
import { TAURI_MOCK } from "./tauri-mock.js";

// Demo recording: switching the active model from the composer's model picker.
// The picker (aria-label "Select model") is a Popover grouped by provider
// (Claude / Codex / Pi); selecting an option updates the composer chip label.
// Mocked-IPC path — the real Thread + model picker run in Chromium; the DB write
// behind the switch resolves through the mock.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(TAURI_MOCK);
});

test("switch the active model from the composer picker", async ({ page }) => {
  await page.goto("/");

  // Open the seeded thread to reach the composer.
  await page.getByText("Steer + abort demo").first().click();
  await expect(page.getByLabel("Message input")).toBeVisible();

  // The picker starts on the seeded Pi model.
  const picker = page.getByLabel("Select model");
  await expect(picker).toContainText("DeepSeek V4 Flash");
  await page.waitForTimeout(900);

  // Open the picker — provider-grouped model options appear.
  await picker.click();
  await expect(page.getByText("Opus 4.6", { exact: true })).toBeVisible();
  await page.waitForTimeout(900);

  // Switch to a Claude model.
  await page.getByText("Opus 4.6", { exact: true }).click();
  await page.waitForTimeout(700);

  // The composer chip reflects the new model.
  await expect(picker).toContainText("Opus 4.6");
  await page.waitForTimeout(900);

  // And switch again — to a Codex model — to make the demo legible.
  await picker.click();
  await page.getByText("Codex 5.3", { exact: true }).click();
  await expect(picker).toContainText("Codex 5.3");
  await page.waitForTimeout(900);
});
