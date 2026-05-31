// Smoke e2e: proves the built Tauri app boots through its real IPC path.
//
// Reaching a rendered composer means the webview loaded, the Tauri runtime is
// up, SQLite migrations ran via tauri-plugin-sql, and RuntimeProvider mounted —
// none of which a plain-browser Playwright run against the dev server can show.
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

  it("shows the message composer", async () => {
    // aria-label is a stable contract from assistant-ui's ComposerPrimitive.Input.
    const composer = await $('[aria-label="Message input"]');
    await composer.waitForDisplayed({ timeout: 60000 });
    await expect(composer).toBeDisplayed();
  });

  it("exposes the model selector", async () => {
    const modelSelect = await $('[aria-label="Select model"]');
    await expect(modelSelect).toBeExisting();
  });
});
