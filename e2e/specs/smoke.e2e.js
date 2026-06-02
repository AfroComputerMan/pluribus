// Smoke e2e: proves the built Tauri app boots through its real IPC path.
//
// Reaching the app's first usable surface — the message composer (when the
// active thread has a workspace) or the WorkspacePicker (on a fresh profile) —
// means the webview loaded, the Tauri runtime is up, SQLite migrations ran via
// tauri-plugin-sql, and RuntimeProvider mounted; none of which a plain-browser
// Playwright run against the dev server can show.
//
// The opt-in `e2e` CI job runs against a FRESH Tauri profile with no seeded
// workspace, so this spec must NOT assume the composer is present.
//
// This is the baseline every PR's video builds on. For a feature PR, add a spec
// alongside this one that drives the specific surface (see the template at the
// bottom of e2e/README.md) so the recorded video demonstrates the change.

describe("Pluribus app boot", () => {
  it("renders the React root", async () => {
    const root = await $("#root");
    await root.waitForExist({ timeout: 60000 });
    // A mounted app has children under #root, not an empty shell.
    await browser.waitUntil(
      async () => (await root.$$("*")).length > 0,
      { timeout: 60000, timeoutMsg: "#root never received children — app failed to mount" }
    );
  });

  it("boots to a usable surface (composer or workspace picker)", async () => {
    // With a workspace the composer renders; on a fresh profile the app shows
    // the WorkspacePicker ("Select a workspace") and withholds the composer.
    // Either proves the real IPC boot path completed.
    await browser.waitUntil(
      async () => {
        const composer = await $('[aria-label="Message input"]');
        const picker = await $("*=Select a workspace");
        return (
          (await composer.isDisplayed().catch(() => false)) ||
          (await picker.isDisplayed().catch(() => false))
        );
      },
      {
        timeout: 60000,
        timeoutMsg:
          "neither the composer nor the workspace picker appeared — app failed to boot",
      }
    );
  });

  it("exposes the model selector when a thread is composable", async () => {
    // The model selector lives inside the composer, which only mounts when the
    // active thread has a workspace. On a fresh profile (no workspace) there is
    // no composer yet, so there is nothing to assert — the boot check above
    // already proved the app came up.
    const composer = await $('[aria-label="Message input"]');
    if (!(await composer.isDisplayed().catch(() => false))) return;

    const modelSelect = await $('[aria-label="Select model"]');
    await expect(modelSelect).toBeExisting();
  });
});
