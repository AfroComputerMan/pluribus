/**
 * Demo: real-time control of a running agent — steer (queued) + abort (#20).
 *
 * Both controls are gated on the Rust-authoritative `agent_running` flag (true
 * only while the agent is actually mid-turn), NOT assistant-ui's `isRunning`.
 * This flow:
 *   1. Reaches the chat surface and sends a prompt to start a run.
 *   2. Watches the run-state-gated controls APPEAR — the steer side-channel
 *      input and the Stop/abort button — once the agent is actually running.
 *   3. QUEUES a steer message (applied at the next step, not a mid-token
 *      interrupt) and confirms the transient "applies at the next step" notice.
 *   4. ABORTS the run via the Stop control and confirms both gated controls
 *      disappear once the agent settles.
 *
 * The recorded video IS the proof, so the flow favours a legible, watchable
 * sequence over exhaustive assertions, with short beats so each state change
 * is visible.
 */

const SEL = {
  composer: '[aria-label="Message input"]',
  send: '[aria-label="Send message"]',
  stop: '[aria-label="Stop generating"]',
  steerInput: '[aria-label="Steer the running agent"]',
  sendSteer: '[aria-label="Send steer"]',
};

/** Short, deliberate pause so a viewer can register the state change. */
const beat = (ms = 900) => browser.pause(ms);

describe("Steer + abort controls (#20)", () => {
  // This spec drives a REAL agent run (the Pi backend spawns a sandbox that
  // calls OpenRouter), so it needs OPENROUTER_API_KEY and the
  // pluribus-pi-sandbox:base image. Skip when those prerequisites are absent —
  // e.g. the opt-in CI job, which installs the Tauri/WebKit stack but provides
  // neither — so the suite never fails for missing infra. Runs locally (or in a
  // Pi-provisioned job) where the agent can actually start.
  before(function () {
    if (!process.env.OPENROUTER_API_KEY) {
      this.skip();
    }
  });

  it("surfaces the steer side-channel and abort while the agent runs, then aborts", async () => {
    // --- 1. Reach the chat surface ------------------------------------------
    const composer = await $(SEL.composer);
    await composer.waitForDisplayed({ timeout: 30_000 });
    await beat();

    // Neither run-state-gated control should exist before a run starts.
    await expect(await $(SEL.steerInput)).not.toBeExisting();
    await expect(await $(SEL.stop)).not.toBeExisting();

    // --- 2. Start a run ------------------------------------------------------
    await composer.setValue(
      "List the files in this repository, then summarise what the project does.",
    );
    await beat();
    await $(SEL.send).click();

    // --- 3. Wait for the agent to actually be running (Rust-authoritative) ---
    // The steer input only mounts while `agent_running` is true, so its
    // appearance is our signal the run is genuinely in flight.
    const steerInput = await $(SEL.steerInput);
    await steerInput.waitForDisplayed({ timeout: 60_000 });

    // The abort/Stop control is gated on the same flag and replaces Send.
    const stop = await $(SEL.stop);
    await stop.waitForDisplayed({ timeout: 60_000 });
    await expect(stop).toBeDisplayed();
    await beat();

    // --- 4. Queue a steer message -------------------------------------------
    await steerInput.setValue("Actually, focus only on the Rust files.");
    await beat();
    await $(SEL.sendSteer).click();

    // The steer is queued (applied at the next step) and the input clears.
    await browser.waitUntil(async () => (await steerInput.getValue()) === "", {
      timeout: 10_000,
      timeoutMsg: "steer input did not clear after queueing",
    });

    // Transient notice confirms the queued semantics for the viewer.
    const notice = await $('p*=applies at the next step');
    await notice.waitForDisplayed({ timeout: 10_000 });
    await expect(notice).toBeDisplayed();
    await beat(1500);

    // --- 5. Abort the run ----------------------------------------------------
    await stop.click();
    await beat();

    // Once the agent settles, BOTH run-state-gated controls disappear and the
    // Send control returns — proving the gating is driven by real run-state.
    await browser.waitUntil(async () => !(await steerInput.isExisting()), {
      timeout: 30_000,
      timeoutMsg: "steer control did not disappear after abort",
    });
    await browser.waitUntil(async () => !(await stop.isExisting()), {
      timeout: 30_000,
      timeoutMsg: "stop control did not disappear after abort",
    });

    const send = await $(SEL.send);
    await send.waitForExist({ timeout: 30_000 });
    await expect(send).toExist();
    await beat();
  });
});
