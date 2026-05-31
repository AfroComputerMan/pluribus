// Agent-guided PR demo recorder.
//
// Turns "record a video proving this PR" into an orchestrated, repeatable flow:
//   1. Plan  — an agent reads the diff + UI components, finds the user-visible
//              surface, and writes a WebdriverIO spec that drives it.
//   2. Record — an agent builds the debug app and runs the recorder, capturing
//              real output. Where the Tauri toolchain (cargo/bun) is missing it
//              says so honestly instead of faking a video.
//
// Invoke (after this PR merges, or via scriptPath):
//   Workflow({ name: 'record-pr-demo', args: { feature: 'steer control (#20)',
//              componentPath: 'src/components/assistant-ui/thread.tsx',
//              repoDir: '/abs/path/to/worktree' } })
//
// The recording itself only succeeds where Rust+Bun+a display exist (locally or
// the `e2e` CI job) — see e2e/README.md.

export const meta = {
  name: 'record-pr-demo',
  description: 'Plan a demo from the PR diff, write a WebdriverIO spec, then build + record a video proving the change',
  phases: [
    { title: 'Plan demo' },
    { title: 'Record' },
  ],
}

const repoDir = (args && args.repoDir) || '.'
const feature = (args && args.feature) || 'the change on the current branch'
const componentPath = (args && args.componentPath) || 'src/components'

const PLAN_SCHEMA = {
  type: 'object',
  required: ['hasUiSurface', 'summary'],
  properties: {
    hasUiSurface: { type: 'boolean', description: 'false for backend-only / docs PRs' },
    specPath: { type: 'string', description: 'path of the spec file written (empty if no UI surface)' },
    summary: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
    selectors: { type: 'array', items: { type: 'string' } },
    note: { type: 'string' },
  },
}

const RECORD_SCHEMA = {
  type: 'object',
  required: ['ran', 'toolchainAvailable'],
  properties: {
    ran: { type: 'boolean' },
    toolchainAvailable: { type: 'boolean' },
    videoPath: { type: 'string' },
    output: { type: 'string', description: 'real command output (tail)' },
    blockers: { type: 'array', items: { type: 'string' } },
  },
}

phase('Plan demo')
const plan = await agent(
  `You are setting up an end-to-end DEMO RECORDING for the Tauri desktop app Pluribus.
WORK EXCLUSIVELY INSIDE: ${repoDir}
  - \`cd ${repoDir}\` before any git/read/grep command.
  - Write the spec ONLY under ${repoDir}/e2e/specs/ — never in any other worktree or checkout.
  - That directory already contains the e2e harness (wdio.conf.js, README.md, smoke.e2e.js). Do NOT re-scaffold it; add only your feature spec.
Feature/PR to demonstrate: ${feature}
Likely component(s): ${componentPath} (relative to ${repoDir})

Steps:
1. Read the git diff for the branch and the relevant UI components. Decide whether the change has a USER-VISIBLE surface. Backend-only (process lifecycle, DB) and docs changes do NOT — set hasUiSurface:false and stop (no spec).
2. If it is visual: identify STABLE selectors — prefer existing aria-label attributes already on the components (e.g. "Message input", "Select model", "Steer the running agent", "Send message", "Stop generating").
3. Write a WebdriverIO spec at ${repoDir}/e2e/specs/<kebab-feature>.e2e.js that drives that surface in a clear, watchable flow — this IS the video. Match the style of ${repoDir}/e2e/specs/smoke.e2e.js and the template in ${repoDir}/e2e/README.md. Keep it deterministic; the artifact is the proof, so favour a legible flow over exhaustive assertions.
Return the structured result.`,
  { phase: 'Plan demo', schema: PLAN_SCHEMA }
)

if (!plan || !plan.hasUiSurface) {
  log(`No UI surface for "${feature}" — nothing to record (per repo rule, note this in the PR).`)
  return { recorded: false, reason: 'no-ui-surface', plan }
}

phase('Record')
const record = await agent(
  `Record the e2e demo video in the repo at ${repoDir} for the spec: ${plan.specPath}.
Run these in order from ${repoDir}, capturing REAL output:
  1. bun run e2e:build
  2. xvfb-run -a -s "-screen 0 1280x800x24" bun run e2e:record   (use plain 'bun run e2e:record' if $DISPLAY is set)
The video lands at e2e/artifacts/pluribus-e2e.mp4.

CRITICAL: if cargo / bun / tauri-driver are missing (command not found / exit 127), report it plainly with toolchainAvailable:false and ran:false. DO NOT fabricate success or invent output — the recording must run where the Tauri toolchain + a display exist. Return the structured result.`,
  { phase: 'Record', schema: RECORD_SCHEMA }
)

return { recorded: !!(record && record.ran), plan, record }
