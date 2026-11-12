# Pluribus Factory: the technical overview

Feature technical docs are checked against this page. Domain words are defined in [`CONTEXT.md`](../CONTEXT.md), and the decisions behind the design are in [`docs/adr/`](adr/), the factory's in [ADR 0006](adr/0006-server-hosted-software-factory.md). Decision ids such as A2 or W5 are listed there. PLU numbers are the vault tickets in the Pluribus Factory project, whose locked contracts live in the vault note Reference/Architecture. Paths run from the repo root.

Pluribus Factory is a TypeScript server on Bun that runs on the host, reads each project's `.factory/` folder, keeps its board and runs in SQLite, and drives coding agents that turn GitHub issues into PRs merged into `dev` (ADR 0006). As of 12 Nov 2026 none of it is built: the repo still holds the Tauri 2 desktop chat app (`src/`, `src-tauri/`, `sidecar/`), and every path below marked new arrives with the ticket named. M0 (PLU-101 to PLU-111, GitHub issues #3 to #13) builds the server, and is held until the design (PLU-112) and these docs (PLU-113) are done.

## Layers

Entry (UI, CLI, HTTP, jobs) calls domain (pure logic, no I/O), which calls adapters (database, network, filesystem) through their interfaces (vault Architecture `## Layers`). A domain file imports no adapter implementation, so the state machine, gates, queue, capacity decision, merge gate and handover rules run in tests without I/O.

## Modules

| Module | Path | Owns | Depends on | Status |
|---|---|---|---|---|
| Server entry | `apps/server/src/entry/` | The HTTP API on `Bun.serve` and SSE (`http.ts`), the GitHub webhook route (`webhooks.ts`), the scheduler tick (`scheduler.ts`), handover routes and the `pluribus` CLI (`handover-routes.ts`, `cli.ts`), the capacity route (`capacity-routes.ts`), schedules and generic webhooks (`automations.ts`), the Factory API and MCP endpoint (`factory-api.ts`, `mcp.ts`) | domain, adapters | new: PLU-103, PLU-104, PLU-107, PLU-108, PLU-124, PLU-128, PLU-129 |
| Server domain | `apps/server/src/domain/` | The work-item state machine and its gates (`work-item.ts`), GitHub event mapping and the label map (`github-events.ts`, `labels.ts`), the merge gate (`merge-gate.ts`), queue order, capacity, and reap and wake (`queue.ts`, `capacity.ts`, `lifecycle.ts`), handover validation, reply detection and the digest (`handover.ts`, `digest.ts`), branch naming (`branch-name.ts`), provider routing (`routing.ts`), hibernation (`hibernation.ts`), payload filters (`payload-filter.ts`), metrics and scoring (`metrics.ts`, `scoring.ts`) | adapter interfaces only | new: PLU-103 to PLU-108, PLU-126 to PLU-128, PLU-130 |
| Server adapters | `apps/server/src/adapters/` | The SQLite store and its migrations (`store.ts`, `migrations/*.sql`), GitHub REST with App installation tokens (`github.ts`), drivers (`drivers/driver.ts`, `t3.ts`, `omp-rpc.ts`, `claude.ts`, `codex.ts`), git worktrees (`worktrees.ts`), agent containers (`containers.ts`), ntfy (`ntfy.ts`), the auth gateway (`auth/`), run traces (`traces.ts`) | domain types | new: PLU-103, PLU-104, PLU-106, PLU-108, PLU-126, PLU-127, PLU-130 |
| Logger | `apps/server/src/log.ts` | `log(event, fields)` writing JSON lines | nothing | new: PLU-103 |
| Factory schema | `packages/factory-schema/` | One JSON Schema per `.factory/` file type (`src/schemas/*.json`), the loader and resolver (`src/load.ts`, `src/resolve.ts`), and the `bin/validate.ts` CLI | nothing | new: PLU-102 |
| Web app | `apps/web/` | The React UI moved from `src/` with `@assistant-ui/react` and the shadcn `ui/` set, the API and SSE client (`src/lib/api.ts`), the timeline row builder (`src/lib/timeline-rows.ts`), and one component folder per screen (`src/components/session/`, `inbox/`, `board/`, `runners/`, `evals/`) | the server's HTTP API and SSE | new: PLU-120 to PLU-125 |
| Desktop wrapper | `apps/desktop/` | A Tauri shell that opens the web app against the server | web app | new: PLU-133 |
| Pluribus's own factory | `.factory/` | `factory.yaml`, `policy.yaml`, the foreman, engineer and reviewer agents, later the retro agent, the skills, and the scorers | factory schema | new: PLU-109, PLU-130, PLU-131 |
| Scripts | `scripts/` | `protect-branch.ts`, `deploy.sh`, `smoke-deploy.sh`, `e2e-issue.ts`, `replay-triage.ts`, `replay-retro.ts` | server | new: PLU-105, PLU-109 to PLU-111, PLU-131 |
| Server image | `apps/server/Dockerfile` | The container the server runs in on the host | server | new: PLU-110 |
| Tests | `apps/*/tests/`, `packages/*/tests/`, `apps/web/e2e/`, `tests/prompts/` | `*.test.ts` run by `bun test`, Playwright suites, and prompt suites | the module under test | new: with each ticket whose `## Slice` names them; `apps/web/e2e/` with PLU-120 to PLU-125, `tests/prompts/` with PLU-109 and PLU-131 |
| Legacy UI | `src/` | Today's React UI over the legacy providers | `src-tauri/`, `sidecar/` | exists; moves to `apps/web` in PLU-120 |
| Legacy desktop backend | `src-tauri/` | The Rust Tauri app, its SQLite migrations, and the Pi and Codex services (`src-tauri/src/pi/`, `src-tauri/src/codex/`) | none in the factory | exists; removed in PLU-133 |
| Legacy sidecar | `sidecar/agent-sdk-bridge/` | The Bun-compiled Claude Agent SDK bridge | `src-tauri/` | exists; removed in PLU-133 |
| Root tests | `tests/` | Vitest specs for the agent registry, status store, status transitions, concurrency governor and write serializer | `src/lib/` | exists; PLU-103 ports the status-transition and write-serializer cases, PLU-107 the concurrency-governor cases, and the old files go when PLU-120 moves `src/lib/` (Noah, 12 Nov 2026) |
| CI | `.github/workflows/ci.yml` | Builds the frontend, compiles the sidecar and runs `cargo check` on PRs into and pushes to `main`; no tests | the legacy app | exists; PLU-101 adds the `dev` trigger and a `bun test` job, PLU-102 adds `validate` (Noah, 12 Nov 2026) |

## Contracts

Every value that crosses a service, repo or process boundary (vault Architecture `## Contracts`). Both sides are named; a change to one updates this page.

- `.factory/` files. `factory.yaml`, `policy.yaml`, `agents/<name>/agent.md`, `skills/<name>/SKILL.md`, `automations/<name>/automation.md`, `runners/<name>.yaml`, `webhooks/<name>.yaml` and `scorers/<name>/scorer.md`, in Warp's `v1alpha1` layout extended with `harness.type` (`omp`, `claude`, `codex`), `auth.source` (`subscription`, `apiKeySecret`, `local`) and `policy.yaml`: the spec gate for features, the merge target, human-only branches, hard stops, the assumption cap and the board stages. `benchmarks/` is reserved and ignored. The path is the resource name; inheritance runs `agentDefaults` to agent to automation, `secrets` and `mcpServers` replace rather than merge, and `model` together with `harness` is rejected. `load` returns a typed `FactoryConfig` or errors with the file and JSON pointer (`packages/factory-schema/src/load.ts`, `resolve.ts`). Read by the server, by `bun packages/factory-schema/bin/validate.ts <repo>` in each project's CI (exit 0 or 1), by agents editing config and by the retro agent (W3, PLU-102).
- Work item. Stages `inbox, ready, triage, spec, building, ci-wait, review, done, cancelled`, plus a `waiting_on_you` flag. `(item, event, policy) -> {item, effects} | rejection` in `apps/server/src/domain/work-item.ts`. A feature cannot enter `building` without an approved spec when policy asks for one, `done` needs a merged PR, and only a human approves a spec. Every accepted transition writes one `events` row; every changing row carries a `version` for optimistic writes. Read by the web UI, the label mirror and the scheduler (PLU-103).
- Label mirror. Kira's labels `ready-for-agent`, `agent-working`, `ci-wait`, `needs-info` and `ready-for-human`, in both directions (`apps/server/src/domain/labels.ts`): a label Noah adds moves the work item, a transition sets the labels, and the App ignores its own label events. A reconcile job pages through every open issue with a factory label at start and hourly (W1, PLU-104).
- HTTP API. `GET /api/projects`, `GET /api/work-items`, `GET /api/work-items/:id`, `POST /api/work-items` (a new request), `GET /api/events` (SSE of work-item and run events) and `GET /healthz`, in `apps/server/src/entry/http.ts`. Every `/api/*` route needs the bearer token. Called by the web app's `apps/web/src/lib/api.ts` (PLU-103, PLU-120). Shapes: `GET /api/projects` returns `projects` rows; the two work-item reads return `work_items` rows with their stage, `waiting_on_you` and `version`; `POST /api/work-items` takes a new request with a title (PLU-122) and returns the new work item; `GET /api/events` streams work-item transitions (item, from, to, by) and run events (PLU-103 tables and its `work_item.transition` log line).
- GitHub webhook delivery. `POST /webhooks/github` (`apps/server/src/entry/webhooks.ts`) verifies `X-Hub-Signature-256` (401 when it fails), returns 413 above 256 KB, dedupes on `X-GitHub-Delivery` (202 and nothing more for a duplicate, also after a restart), answers 202 on accept, stores every delivery as accepted, duplicate or rejected (metadata only for rejected), and maps events to work-item events in `github-events.ts`. Sent by the `pluribus-factory` GitHub App for `issues`, `issue_comment`, `pull_request`, `pull_request_review`, `check_suite` and `workflow_run` (PLU-104).
- Generic webhooks and automations. `webhooks/<name>.yaml` take token or signature auth (`github`, `standard_webhooks`, `sentry`, `stripe`), dedupe on the delivery id, keep a delivery log, cap a body at 256 KB and 60 deliveries a minute, and filter the payload; a test filter replays a stored delivery. `automations/<name>/automation.md` fire on a `schedule` (cron, shown in +08:00) or a `webhook`, once per slot across restarts, and each match starts a run with the automation's prompt. The payload reaches the agent as an attached file marked untrusted (`apps/server/src/entry/automations.ts`, `webhooks.ts`, `domain/payload-filter.ts`; PLU-128).
- Runner driver. The TypeScript interface in `apps/server/src/adapters/drivers/driver.ts`: `start({workItem, agent, worktree, prompt}) -> RunRef`, `send(run, text)`, `stop(run)`, `status(run) -> running | settled | dead`, `events(run)` as an async iterator, and capability flags. Called by the scheduler and by the live session view through SSE (PLU-106).
- Timeline rows. A union on `kind`: `message`, `work`, `work-live`, `working`, `thinking`, `turn-fold`, `event`, `proposed-plan`, `pending-approval`, `pending-question` and `error` (with a usage-limit variant), built from a run's driver events in `apps/web/src/lib/timeline-rows.ts`. Read by the live session view and the inbox (PLU-121).
- Agent CLI. `pluribus handover --class <c> --question <q> --pick <p> --default <d>` exits 2 and posts nothing without a pick and a default; otherwise it posts one comment as the App with a hidden marker, sets `waiting_on_you` and `needs-info`, and sends one ntfy push. `pluribus assume` records an assumption, listed on the PR. Both take a per-run token scoped to that run's work item (`apps/server/src/entry/cli.ts`, `handover-routes.ts`, `domain/handover.ts`). Any comment after the newest handover that is not from a bot is Noah's reply and wakes the run (PLU-108).
- Merge gate. `apps/server/src/domain/merge-gate.ts` is called by the webhook handler and the scheduler tick. It takes the PR head, its check runs, the reviewer's verdict, the work item and the policy, and returns merge, or blocked with a reason. It passes a PR only when the newest run of every required workflow is green on its head (cancelled is not green), the reviewer approved that same head, the work item is not waiting on Noah, and the target is the policy's merge branch and not human-only. A PR targeting `main` is always blocked. The adapter then squash-merges as the App and the work item goes to `done` (PLU-105).
- Factory API and MCP. `send_task`, `get_task` (which takes a lock, unlike Warp's), `message_foreman` and `complete_task`, as REST routes and an MCP server over the same domain calls (`apps/server/src/entry/factory-api.ts`, `mcp.ts`). Called by omp on Noah's laptop and by the inbox's New request box (PLU-129, PLU-122). Shapes: `send_task` takes a new request and returns the work item, reusing `POST /api/work-items`; `get_task(task)` returns the work item with a lock, or a conflict when another client holds it; `message_foreman(task, text)` sends text to the foreman; `complete_task(task)` is refused from a client that does not hold the lock (PLU-129 acceptance and edge cases).
- Notifications. Sent from the server to Noah's phone through the ntfy server Kira's factory already uses, on a new `pluribus` topic (Noah, 12 Nov 2026; `apps/server/src/adapters/ntfy.ts`, `domain/digest.ts`). A push carries one handover: its work item, its class and a link to the comment (PLU-108's `handover.post` fields). The digest goes after 08:00 at +08:00 and carries the list of work items waiting on Noah; none goes when nothing waits (W8, PLU-108).

## Data

- Config lives in git: each project's `.factory/` (F7, W2). W2 also puts a shared library in Pluribus; nothing is built for it until a second project needs it, and PLU-132 decides where it lives (Noah, 12 Nov 2026).
- Runtime state lives in SQLite through `bun:sqlite` in WAL mode, with migrations in `apps/server/src/adapters/migrations/*.sql` and tables `projects`, `work_items`, `runs`, `events`, `handovers`, `assumptions` and `deliveries` (PLU-103). The database lives in the server's data directory on the host (PLU-110).
- Each run keeps its full trace (prompts, tool calls, outputs and PR links) through `traces.ts`, and each scorer's score and pass or fail is stored with it (PLU-130).
- GitHub holds the issues, the mirrored labels, handover and assumption comments, and the PRs. The board is Pluribus's; GitHub labels are its mirror (W1).
- Repos are cloned once into a pool at `<data>/repos/<owner>/<repo>`; each work item gets a worktree on branch `plu/<item>-<slug>`, removed after merge (PLU-106).
- A nightly `sqlite3 .backup` goes to a backup directory, keeping 14 copies (PLU-110).
- Agents keep no memory between runs at first (E3).

## Runtime on the host

- The host is shared with other services and freezes when RAM runs out, so every container gets a measured memory cap.
- The server runs in one container built from `apps/server/Dockerfile` and started with a memory cap that is measured, never guessed (PLU-110).
- It listens on the private network only. A tunnel routes `/webhooks/*` and nothing else (I2, PLU-110).
- In v0 every run is a T3 Code thread on the T3 server on the host, bound to its work item's worktree (F5, PLU-106). From PLU-127, Pluribus starts its own agent containers: one per writing agent, one shared by read-only agents (A5).
- Worktrees live on local disk. Paths on a FUSE share are refused, because git fails on FUSE (PLU-106).
- The scheduler starts a model turn only when free RAM from `/proc/meminfo` is above the policy minimum and running agents are below the limit, which starts at 4 (A4, PLU-107). It claims at most one work item per tick, wakes on webhooks, and runs a safety tick every 10 minutes for missed ones. From PLU-127, an agent parked on CI or waiting on Noah hibernates: its process stops and its run resumes later. Five omp ACP sessions sampled on the box used 325 to 470 MB RSS each (vault Research/Pi Harness and Subscriptions, TL;DR and section 6).
- Noah reaches the server from the web app installed on his phone over the private network, from the desktop wrapper (I1, PLU-133), and from omp on his laptop through the Factory API and MCP endpoint (PLU-129).
- Logs go to container stdout as JSON lines, and every state change also writes an `events` row (vault Architecture `## Observability`).

## Drivers and providers

- Drivers. `t3` comes first (F5, PLU-106): it launches each agent as a T3 thread bound to its worktree through T3's MCP endpoint, with the same calls Kira's factory uses (launch, send, read, list), and `harness.type` picks the T3 provider instance. The thread id is stored on the run, so a restart resumes rather than relaunches. PLU-127 adds `omp-rpc` (`omp --mode rpc`), `claude` (`claude -p --output-format stream-json` under Noah's login) and `codex` (`codex exec`); the default driver moves from T3 to them once they pass PLU-111's end-to-end run.
- Harness. Claude Code, the `claude` binary, is the default harness; omp stays the harness for local models and API keys, and a `codex` driver is kept (A1 as amended). Pluribus's own `factory.yaml` sets `agentDefaults.harness` to `{type: claude}` (PLU-109).
- Providers at launch. Claude Max through `claude`; API keys (Anthropic, OpenAI, OpenRouter) as overflow when a window runs out; local models (Ollama, Unsloth on the host) for roles the policy marks local-eligible. Noah has no ChatGPT plan, so Sign in with ChatGPT is not a launch provider; it returns if he takes one (A3 as amended, PLU-126).
- Claude only through `claude`. Claude runs only through the unmodified `claude` binary under Noah's login; no Anthropic OAuth goes through omp or Pi, and validation refuses a `.factory/` that asks for it (A2, PLU-126). T3's Claude provider uses Claude Code's own login and configuration (vault Research/Pi Harness and Subscriptions, section 5). A stray `ANTHROPIC_API_KEY` would switch `claude` to API billing, so the gateway guards against it (PLU-126).
- Auth gateway. A gateway on the host is the only holder and refresher of logins; agents get scoped tokens limited by model and account, and no agent container or worktree holds a provider token (`apps/server/src/adapters/auth/`, PLU-126). Claude's 5-hour and weekly usage windows are a scheduler input with a reserve; an exhausted window routes the next run to the configured overflow and logs why, and with no overflow the run waits (`apps/server/src/domain/routing.ts`).

## Security and trust boundaries

| Trust boundary | Input validated by | Secrets source | Key and its least privilege |
|---|---|---|---|
| GitHub webhooks, public through the tunnel | signature, size cap, dedupe, schema | webhook secret in the root-only env file on the host | one secret per webhook |
| Web UI and API, private network only | bearer token on every `/api/*` route | root-only env file | one token, UI and API only |
| Agent sandboxes | per-run token scoped to the run's work item; container egress allowlist (PLU-127) | none inside the sandbox | the agent CLI can touch only its own work item |
| Provider logins | the auth gateway is the only holder and refresher (PLU-126) | Noah's own logins on the host; API keys as overflow | Claude only through the unmodified `claude` binary under Noah's login; no Anthropic OAuth through omp or Pi |
| GitHub writes | the merge gate (PLU-105) plus branch protection on `dev` | the GitHub App private key in the env file | contents, issues and PRs read/write on enrolled repos; checks and actions read; no admin |

Source: vault Architecture `## Security`. The env file holds the App private key, the webhook secret, the API token and the ntfy topic; none of them go in the repo or the vault (PLU-110). Prompt text is not a boundary: an agent's instructions change what it is told, not what it can reach, so the gates above live in code and in GitHub's branch protection (Warp research, section 1).

Known gap: until PLU-127, agents run inside T3's container with their own worktrees but without their own container or egress allowlist (ADR 0006). PLU-126 gives a writing agent's `claude` binary Noah's login through the gateway, so the container holds no provider token (Security rows above; vault Research/Pi Harness and Subscriptions, Implications: omp's auth-broker pattern). Nobody has yet tested the unmodified `claude` binary behind that gateway; if it does not work, PLU-126 raises it with Noah, because every alternative changes a locked Security row.

## Practices

Each practice is one rule with where it is stated. A feature's technical doc says how it meets every one. Rules that today live only in the vault Architecture note are copied here so agents can read them in the repo.

- T1. Write the failing test first, see it fail for the reason it targets, then implement. (PLU-109, the engineer agent ported from Kira's `factory/roles/engineer.md`)
- T2. Keep the layers: entry calls domain, domain calls adapters only through their interfaces, and domain code does no I/O. (vault Architecture `## Layers`)
- T3. Prove domain logic with `bun test` unit tests in the package's own `tests/`, without I/O: the state machine, gates, queue, capacity, merge gate and handover rules. (vault Architecture `## Testability` and `## Layout`)
- T4. Test adapters against the real thing: a real SQLite file in a temp dir, real HMAC over recorded GitHub payloads, GitHub against a sandbox repo, T3 against a throwaway thread. (vault Architecture `## Testability`)
- T5. Keep `scripts/e2e-issue.ts` green: it files a real fix on Pluribus and follows it to a merge into `dev`, and it passes on every driver before that driver becomes the default. (vault Architecture `## Testability`, PLU-111, PLU-127)
- T6. Test a prompt by replaying recorded cases through it: Kira's issues through the foreman with `scripts/replay-triage.ts` and the cases in `tests/prompts/`. (vault Architecture `## Testability`, PLU-109)
- T7. A value that crosses a service, repo or process boundary is a contract on this page, and a change to it updates both sides and this page in one PR. (vault Architecture `## Contracts`)
- T8. A `.factory/` change passes `bun packages/factory-schema/bin/validate.ts <repo>`. (PLU-102)
- T9. Log with `log(event, fields)` as JSON lines: a `request_id` at each entry point, the work item and run ids on every domain line, an `events` row for every state change, and never a token value. (vault Architecture `## Observability`, PLU-126)
- T10. Validate untrusted input at the boundary: signature, size cap, dedupe and schema on every webhook, and a webhook payload reaches an agent only as an attached file marked untrusted. (vault Architecture `## Security`, PLU-128)
- T11. Keep secrets in the root-only env file on the host: never in the repo, the vault, a sandbox or a log. (vault Architecture `## Security`, PLU-110)
- T12. Run Claude only through the unmodified `claude` binary under Noah's login, never Anthropic OAuth through omp or Pi. (A2, ADR 0006)
- T13. The factory merges only through the merge gate into `dev`, never into `main`. (W5, PLU-105)
- T14. Put worktrees, the database and the clone pool on local disk; a worktree path on a FUSE share is refused. Backups go to a separate backup directory. (PLU-106, PLU-110)
- T15. Start a container on the host only with a measured memory cap. (PLU-110)
- T16. A schema change adds a migration in `apps/server/src/adapters/migrations/` with a store test against a real SQLite file (PLU-103). A schema or stored-data change that one revert PR cannot undo is a hard stop in `policy.yaml`, so the agent hands it over to Noah (Noah, 12 Nov 2026; `docs/product.md`, "When an agent is unsure"; W6).
- T17. UI follows [`docs/design-language.md`](design-language.md): its tokens, a charcoal canvas, amber for Noah and the active item, teal for live, IBM Plex Sans and Mono, no shadows, gradients, toasts or entrance motion, and no notification badges with counts. (I3 as amended, design-language.md sections 7 and 11, [AGENTS.md](../AGENTS.md) Design Language)
- T18. Reuse assistant-ui, shadcn and Radix primitives before writing a component, and rebuild T3's patterns on them rather than porting T3's code. ([AGENTS.md](../AGENTS.md), ADR 0006)
- T19. Every screen has empty, loading and error states, works at 320 px wide and 1.3x text, and shows only what the data backs. (PLU-120 to PLU-122, PLU-112 design brief)
- T20. TypeScript is strict with no unused locals or parameters, 2-space indented, file names in kebab-case, imports through `@/*`. That holds in `apps/server/src` too: where a ticket names a file in camelCase (`workItem.ts`), it is built as kebab-case (`work-item.ts`), as listed under Modules (Noah, 12 Nov 2026). ([AGENTS.md](../AGENTS.md))
- T21. Commit subjects use Conventional Commit prefixes (`feat:`, `refactor:`, `docs:`), and a PR says what changed and why, links its issue, lists the verification it ran, and shows screenshots for UI changes. ([AGENTS.md](../AGENTS.md))
- T22. Use `CONTEXT.md`'s words, and say so when a change contradicts an ADR. ([docs/agents/domain.md](agents/domain.md))
- T23. Each ticket states its net lines, and no file is added that a later ticket deletes. (vault Architecture `## Clutter`)

## Testing

| Level | What | Where | Run by |
|---|---|---|---|
| Unit | Pure domain logic: state machine, gates, queue, capacity, merge gate, handover rules, routing, metrics | `apps/server/tests/`, `packages/factory-schema/tests/`, `apps/web/tests/` | `bun test <files>` |
| Acceptance | Kira's `factory/__tests__/{queue, ci-wait, restarts, replies, launch, handover, digest, merge-gates}.sh` cases ported as unit cases against the domain | `apps/server/tests/` | `bun test` |
| Integration | Real SQLite in a temp dir, real HMAC over recorded GitHub payloads, GitHub against a sandbox repo, T3 against a throwaway thread | `apps/server/tests/`, `apps/server/tests/fixtures/github/` | `bun test` |
| UI end to end | Each screen at 320 px and desktop widths | `apps/web/e2e/` | `bunx playwright test` |
| Prompts | Replayed Kira issues through the foreman, and later the retro agent | `tests/prompts/` | `bun scripts/replay-triage.ts`, `bun scripts/replay-retro.ts` |
| End to end | A real fix on Pluribus from `ready-for-agent` to merged into `dev`, with stage timings | `scripts/e2e-issue.ts` | `bun scripts/e2e-issue.ts` on the real deployment |
| Deploy smoke | The API unreachable over the tunnel, 401 and 200 over the private network, a GitHub test delivery accepted, state kept across a restart | `scripts/smoke-deploy.sh` | after each deploy |
| Human review | API changes get Noah's curl workflow; UI changes are exercised by Noah on phone and desktop | the PR | Noah |

Code changes start from a failing test (T1). Source: vault Architecture `## Testability` and each ticket's `## Slice`. Today `.github/workflows/ci.yml` only builds the legacy app and runs only for `main`; PLU-101 adds the `dev` trigger and a `bun test` job and PLU-102 adds `validate`, so the merge gate in PLU-105 has a CI check to wait for (Noah, 12 Nov 2026).

## Keeping this current

A PR that adds a module or changes a contract between modules updates this page in the same PR. A new practice comes with its source: the file that states the rule. A change to a decision this page cites happens first in the vault Architecture `## Decisions` and a new ADR.
