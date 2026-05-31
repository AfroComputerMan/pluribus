// Agent-guided PR demo recorder (Playwright / mocked Tauri IPC path).
//
// Turns "record a video proving this PR" into an orchestrated, repeatable flow
// that runs WITHOUT the Rust/Bun toolchain:
//   1. Plan   — an agent reads the diff + UI components, finds the user-visible
//               surface, writes a Playwright spec under e2e/playwright/, and (if
//               needed) extends e2e/playwright/tauri-mock.js with extra seed data
//               or mocked commands.
//   2. Record — an agent runs the spec headlessly (real frontend in Chromium vs.
//               the mocked Tauri IPC boundary) and copies the recorded webm into
//               e2e/playwright/demos/. This actually produces a video, since the
//               mocked-IPC path needs only Node + Playwright.
//
// Invoke (after merge, or via scriptPath):
//   Workflow({ name: 'record-pr-demo', args: { feature: 'model selector',
//              componentPath: 'src/components/assistant-ui/thread.tsx',
//              repoDir: '/abs/path/to/worktree' } })
//
// Fidelity note: this proves the FRONTEND feature. Backend-coupled changes that
// must exercise real invoke()/process control belong to the tauri-driver harness
// (e2e/, the `e2e`-labelled CI job).

export const meta = {
  name: 'record-pr-demo',
  description: 'Plan a demo from the PR diff, write a Playwright spec (mocked Tauri IPC), then record a video proving the change',
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
    specPath: { type: 'string', description: 'path of the *.spec.ts written under e2e/playwright/ (empty if no UI surface)' },
    mockChanged: { type: 'boolean', description: 'true if tauri-mock.js was extended' },
    summary: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
    selectors: { type: 'array', items: { type: 'string' } },
    note: { type: 'string' },
  },
}

const RECORD_SCHEMA = {
  type: 'object',
  required: ['ran', 'recorded'],
  properties: {
    ran: { type: 'boolean', description: 'the playwright test executed' },
    recorded: { type: 'boolean', description: 'a video file was produced' },
    testPassed: { type: 'boolean' },
    videoPath: { type: 'string', description: 'path of the committed demo webm under e2e/playwright/demos/' },
    output: { type: 'string', description: 'real command output (tail)' },
    blockers: { type: 'array', items: { type: 'string' } },
  },
}

phase('Plan demo')
const plan = await agent(
  `You are setting up a browser DEMO RECORDING for the Tauri desktop app Pluribus,
using the mocked-IPC Playwright harness (NOT tauri-driver). It runs the real
frontend in Chromium against a mocked window.__TAURI_INTERNALS__, so no Rust/Bun
build is needed.
WORK EXCLUSIVELY INSIDE: ${repoDir}
  - \`cd ${repoDir}\` before any git/read/grep command.
  - Read e2e/playwright/README.md, e2e/playwright/tauri-mock.js and
    e2e/playwright/steer-abort.spec.ts FIRST to learn the conventions.
Feature/PR to demonstrate: ${feature}
Likely component(s): ${componentPath} (relative to ${repoDir})

Steps:
1. Read the git diff + relevant UI components. Decide if the change has a
   USER-VISIBLE surface. Backend-only (process lifecycle, DB) and docs changes do
   NOT — set hasUiSurface:false and stop (no spec).
2. If visual: identify STABLE selectors — prefer existing aria-labels (e.g.
   "Message input", "Select model", "Select effort level", "Steer the running agent",
   "Send message", "Stop generating").
3. Write a Playwright spec at ${repoDir}/e2e/playwright/<kebab-feature>.spec.ts that
   imports TAURI_MOCK from "./tauri-mock.js", opens the seeded "Steer + abort demo"
   thread, and drives the feature in a clear, watchable flow (use short
   page.waitForTimeout beats between state changes — the artifact is the proof).
   Match steer-abort.spec.ts exactly in style.
4. If the feature needs IPC the mock doesn't cover yet (a new command, more seed
   rows), EXTEND e2e/playwright/tauri-mock.js minimally. Unknown commands already
   return null and are logged to window.__demo.invokeLog — check that log if a
   step doesn't work. Do NOT re-scaffold existing files.
Return the structured result.`,
  { phase: 'Plan demo', schema: PLAN_SCHEMA }
)

if (!plan || !plan.hasUiSurface) {
  log(`No UI surface for "${feature}" — nothing to record (per repo rule, note this in the PR).`)
  return { recorded: false, reason: 'no-ui-surface', plan }
}

phase('Record')
const record = await agent(
  `Record the browser demo video in ${repoDir} for the spec: ${plan.specPath}.
This is the mocked-IPC Playwright path — it needs ONLY Node + Playwright, no
cargo/Rust/Bun build. Run from ${repoDir}, capturing REAL output:
  1. If node_modules is missing: \`bun install\` (or \`npm install\` if bun is absent).
  2. \`node_modules/.bin/playwright install chromium\` (fast if already cached).
  3. \`node_modules/.bin/playwright test --config e2e/playwright/playwright.config.ts ${plan.specPath}\`
     (Playwright auto-starts the Vite dev server via webServer.)
  4. Find the produced video under e2e/playwright/artifacts/**/video.webm and copy
     it to e2e/playwright/demos/<kebab-feature>.webm (that dir is committed; raw
     artifacts/ are gitignored).
Report exactly what happened — set recorded:true only if a real .webm exists, and
testPassed from the playwright result. If a step genuinely fails (e.g. a selector
the spec used doesn't match), report it in blockers; do NOT fabricate a video.
Return the structured result.`,
  { phase: 'Record', schema: RECORD_SCHEMA }
)

return { recorded: !!(record && record.recorded), plan, record }
