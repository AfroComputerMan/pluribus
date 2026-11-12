# Pluribus Factory: the product

Feature docs are checked against this page. The factory's terms are defined in [`CONTEXT.md`](../CONTEXT.md). Decision ids such as A2 or W5 are Noah's answers of 12 Nov 2026, listed in [ADR 0006](adr/0006-server-hosted-software-factory.md) and kept in the vault note Reference/Architecture `## Decisions`. PLU numbers are the vault tickets in the Pluribus Factory project.

## Mission

Pluribus Factory lets one person run AI coding agents across several projects as a factory. Agents pick up GitHub issues and carry each one through stages until it becomes a pull request merged into `dev`. It runs on Noah's own server, uses his subscriptions within each provider's terms, is usable from web, phone and desktop, and improves itself through PRs Noah reviews.

This is the goal on the vault hub (Pluribus Factory, Goal), with one change Noah made on 12 Nov 2026: the agents run on Claude Code, the official `claude` binary under his login, rather than on omp or Pi (A1, A3 as amended). Why it exists: Noah's Kira factory already turns issues into merged PRs, 197 of them from 20 Oct to 11 Nov 2026 with none reverted, but it is about 4,650 lines of scripts built for one repo, its only shared state is GitHub labels and comments, and what breaks is that plumbing, not the agents. Its longest wait is Noah himself: a median 1.9 h from claim to merge with no handover, 40.7 h after one (vault, Research/Kira Factory and Kira Kira Design, TL;DR and sections 8 and 9). The factory makes that loop something any of his projects can join, and spends his time only where it is needed.

## Goals

What the factory works toward, each with what Noah sees when it meets it. A feature doc names the ones it serves as G1 to G7. The numbers are Kira's baseline, which Pluribus must match before Kira moves over (PLU-132).

- G1. Issues become merged PRs without Noah. A work item that needs no answer goes from `ready` to merged into `dev` with no human action (PLU-111). Measured: median claim to merge with no handover (Kira: 1.9 h). Seen in: the board and the live agent session.
- G2. Noah is asked only what only he can answer. An agent looks things up, takes a recorded default where the rule allows, and hands over only otherwise, always with "My pick" and "If you say nothing" (W6, P2, P3). Measured: handovers per work item (Kira: 0.44 per claimed issue, counting all but `infra` handovers, the bar PLU-132 sets). Seen in: the inbox, the ntfy push and the daily digest.
- G3. Nothing broken lands, and `main` stays Noah's. A PR merges into `dev` only with CI green and a reviewer's approval on the same head; nothing merges into `main` (W5, PLU-105). Measured: reverts within 7 days (Kira: none). Seen in: the PR state on each board card.
- G4. Noah can see and steer every agent. Each run's messages, tool calls and status are live, and he can steer, queue or stop it (UI decision, PLU-121). Seen in: the live agent session.
- G5. Several agents run on one box without freezing it. Four to six agents at once, idle ones hibernated, and no model turn starts without room (A4, PLU-107, PLU-127). Seen in: runners and capacity.
- G6. The factory gets measurably better. Delivery metrics and judge scorers show where runs fail, and a retro agent proposes fixes as PRs Noah approves (E1, E2, PLU-125, PLU-130, PLU-131). Seen in: evals and metrics, and the retro PRs.
- G7. Any of Noah's projects can join. A project joins by carrying a `.factory/` folder that validates (W2, W3, PLU-102), starting with Pluribus and then Kira (F2). Seen in: the projects in the sidebar (PLU-120).

## Story

### Whom it follows

Noah, the only user, across his projects. Each line says what the factory changes for that project and words the rest as a goal or as where the factory is headed.

- Pluribus: the factory's first project (F2). Ordinary omp sessions build v0; once Pluribus works one real issue on itself end to end (PLU-111), the factory works its own backlog (F1).
- Kira: its factory keeps running as it is until Pluribus matches Kira's baseline over at least 20 issues; then Kira gets a `.factory/` written from its role files and moves over (PLU-132).
- A later project: it joins by adding a `.factory/` folder and enrolling in Pluribus (W2, G7).

### Where he starts

One person with several projects and one Claude Max login, whose factory for Kira works but is shell scripts tied to one repo, and whose reply time is the factory's longest wait (Mission). Pluribus itself is a desktop chat app today (ADR 0006).

### What the factory changes for him

Issues on any enrolled project move from `ready` to merged into `dev` while he is away (G1). What needs him arrives as one handover with a pick and a default, in one inbox and one daily digest (G2). He watches and steers runs from his phone or desktop (G4), and the factory's own failures come back to him as PRs to approve (G6).

### Where the factory is headed

None of this is built yet (vault hub, Current state at a glance). Each piece is a ticket, and one that pulls against a principle raises it as a question for Noah (Keeping this current).

- Now, as of 12 Nov 2026: the whole app is designed first in `AI Designs/Pluribus Factory.fig` (PLU-112) and these standing docs are written (PLU-113). The build waits for both (Noah, 12 Nov 2026).
- M0, the foundation, built by ordinary omp sessions (F1): PLU-101 to PLU-111, published as GitHub issues #3 to #13 and held. It ends when Pluribus works one real issue on itself (PLU-111).
- M1, the factory's own backlog, filed as issues at M0's exit: the web app and its five screens (PLU-120 to PLU-125), provider routing and the auth gateway (PLU-126), Pluribus's own container runner and drivers (PLU-127), schedules and generic webhooks (PLU-128), the Factory API and MCP endpoint (PLU-129), scorers and metrics (PLU-130), the retro agent (PLU-131), moving Kira over (PLU-132) and the desktop wrapper that retires the Tauri chat app (PLU-133).

## What Pluribus is

Pluribus Factory is a self-hosted software factory on Noah's home server. Each project carries its factory as files in a `.factory/` folder: its agents, policy, skills, automations, runners, webhooks and scorers, in Warp's layout extended (W2, W3). A server reads those files, keeps the board and every run in SQLite (F7), and runs agents that move each work item from GitHub issue to merged PR. Noah supervises from a web app installed on his phone and from a desktop wrapper (I1). Today the repo still holds the Tauri desktop chat app that this replaces (ADR 0006).

## Who it's for

Noah, and only Noah (PLU-112 design brief). He holds the Claude Max login the agents run under (A2, A3), alone approves specs for features and merges into `main` (W5, W7), and supervises from his phone and his desktop (I1). His day runs on +08:00, which sets when the digest goes out (PLU-108). There are no other users: the UI and API take one token and are reachable only on his private network (I2).

What he needs from it: work that finishes without him, handovers he can answer in a line, and a view of what every agent is doing (G1, G2, G4).

## Principles

- P1. Noah's time is the scarce resource. Work that needs no answer from him never waits on him, and what does reaches him in one shape and one place: a push per handover, the inbox, and one daily digest (W8). (Kira research section 8, PLU-108, PLU-122)
- P2. Every handover has one shape: the question, "My pick" and "If you say nothing". A handover without a pick and a default is refused (W6, PLU-108).
- P3. Look it up, then default and record, then hand over. An agent first settles what it is unsure of from what is written down, then takes a conservative default it records as an assumption when the change lands only on `dev` and one PR can undo it, and hands over otherwise. Hard stops always hand over (W6, PLU-109; the list is in "When an agent is unsure").
- P4. Gates are code, not prompt text. A feature cannot enter `building` without a spec Noah approved when the project's policy asks for one, only a human approves a spec, and the merge gate checks CI and review itself (W7, PLU-103, PLU-105). Changing an agent's instructions changes what it is told, not what it can reach (Warp research, section 1).
- P5. `main` is Noah's. The factory merges only into `dev`, and promoting `dev` to `main` stays a manual PR, per project (W5, PLU-105).
- P6. The factory is files in git. Config is reviewable in each project's `.factory/`, runtime state lives in SQLite, and the factory changes its own config only through PRs Noah approves (F7, W2, E2).
- P7. Within each provider's terms. Claude runs only through the official `claude` binary under Noah's login, never through Anthropic OAuth in omp or Pi; API keys are overflow and local models serve what the policy allows (A1, A2, A3).
- P8. One box, measured. No model turn starts without free memory and a free slot, an idle tick makes no model call, idle agents hibernate, and containers start with measured caps (A4, PLU-107, PLU-110, PLU-127).
- P9. One work item, one worktree. Each work item gets its own git worktree, a writing agent gets its own container with no secrets inside, and read-only agents share one (A5, PLU-106, PLU-127). Until PLU-127 lands, agents run inside T3's container (ADR 0006).
- P10. Private by default. The UI and API are reachable only on a private network with one token; only webhook paths are public, through a tunnel (I2).
- P11. Borrow designs, build the engine. The engine is built in Pluribus, borrowing Warp's layout, Kira's loop and T3 Code's way of presenting agents (F4, F5, decision P1, UI decision). T3's patterns are rebuilt on Pluribus's stack, not ported (planning decision in ADR 0006, which Noah can overrule).
- P12. Quiet and dense. The UI follows [`docs/design-language.md`](design-language.md) in a console layout: a charcoal canvas, amber for Noah and the active item, teal for live, IBM Plex Sans and Mono, no shadows, gradients, toasts or entrance motion, and no notification badges with counts. It shows only what the data backs (I3 as amended, design-language.md section 11, PLU-112 design brief).

## Areas

Terms are `CONTEXT.md` entries unless the Area names a screen. The five v1 screens are the inbox, the board, the live agent session, runners and capacity, and evals and metrics (I4). A feature doc names the Areas it changes and the ones it connects to.

| Area | What it does | Takes in | Hands on |
|---|---|---|---|
| Projects | Each enrolled repo and its `.factory/` folder, loaded and validated against the factory schema (PLU-102). | A repo's `.factory/` files | Agents, policy, automations, runners, webhooks and scorers to every other Area; validation errors with file and path |
| Intake | Turns what arrives into work items: GitHub events, schedules, signed webhooks, the New request box, and the Factory API and MCP endpoint (W4). | GitHub webhook deliveries, schedule ticks, generic webhook deliveries, requests from the UI and from omp on Noah's laptop | New work items, and the GitHub events of existing ones, to the Board |
| Board | Holds every work item and its stage, mirrored to GitHub labels in both directions (W1, PLU-104, PLU-123). Noah can drag only where he owns the move: Inbox to Ready, and cancel. | Work items; stage changes from the Scheduler, agents and Noah; labels Noah sets on GitHub | Ready work items to the Scheduler; labels to GitHub; cards to the board screen |
| Scheduler | Claims at most one work item per tick when memory and slots allow, orders the queue, parks runs on CI, resumes dead runs and wakes parked ones (PLU-107). | Ready work items, free memory, running agents, CI results, Noah's replies | Runs to Drivers; resumed runs; a work item handed over after a third failed restart |
| Foreman | Triages each work item and writes the spec for a feature: a product doc and a technical doc, graded by a fresh subagent of the foreman against this page and `docs/technical.md`; never writes code (PLU-109, PLU-112 design brief; Noah, 12 Nov 2026). | A claimed work item and its issue | A graded spec for Noah to approve, a handover, or the work item ready to build |
| Engineer | Builds one work item in one worktree: tests first, push, open the PR, park on CI (PLU-109). | A work item ready to build, and its spec when it has one | A PR; assumptions; handovers |
| Reviewer | Reads the PR and gives `APPROVE` or `CHANGES_REQUESTED` on a named head SHA (PLU-109). | A PR and its head | A verdict to Merge |
| Merge | Merges a PR into `dev` only when CI is green on its head, the reviewer approved that head, nothing waits on Noah and the target is allowed (PLU-105). | A PR, its checks and its verdict | A squash merge into `dev`; the work item to `done`; a blocked reason when it holds back |
| Handovers and assumptions | The `pluribus handover` and `pluribus assume` commands agents call with a per-run token (PLU-108). | An agent's handover (the question, its pick and its default), or a default it took | A comment on GitHub, `waiting_on_you`, a push to Notifications; assumptions listed on the PR |
| Inbox | Everything waiting on Noah: handovers, spec reviews, PR reviews, blocked work items and failed runs, each with an inline action, plus the New request box (PLU-122). | Handovers, specs, PRs, failed runs | Noah's answers back to the waiting run; approved specs to the Board; new requests to Intake |
| Notifications | One ntfy push per handover, and a daily digest after 08:00 (+08:00) that is skipped when nothing waits (W8, PLU-108). | Handovers and the inbox | Pushes to Noah's phone |
| Live agent session | One run as a timeline: messages, tool calls folded into a work log, status, and a composer to steer, queue or stop (UI decision, PLU-121). | A run's driver events | Noah's steer, queued and stop messages to Drivers |
| Runners and capacity | The memory budget, running and hibernated agents, the queue with the reason the next claim waits, and Claude's usage windows (PLU-124). | Capacity decisions, runs, usage windows | Nothing; read-only |
| Drivers and providers | Starts, steers, stops and streams each run on its harness: T3 first, then omp, `claude` and `codex` drivers, routed to Claude Max, an API key or a local model (F5, PLU-106, PLU-126, PLU-127). | Runs from the Scheduler; the agent's harness and auth settings | Driver events to the Live agent session; traces to Evals and metrics; a dead run to the Scheduler |
| Automations and webhooks | Schedules and generic signed webhooks that start runs, with a delivery log and a test filter (PLU-128). | Schedule slots and webhook deliveries | Runs with the automation's prompt; the payload as an untrusted file |
| Factory API and MCP | `send_task`, `get_task` with a lock, `message_foreman` and `complete_task`, so omp on Noah's laptop can hand work to the factory and back (PLU-129). | Calls from omp and the UI | Work items to Intake; messages to the Foreman |
| Evals and metrics | Stores each run's trace, scores a sample with judge scorers, and computes delivery metrics per project and agent (E1, PLU-125, PLU-130). | Traces, runs, work items, merges and reverts | Scores and metrics to the screen and to Retro |
| Retro | A scheduled agent that reads scorer failures and metrics and opens at most three PRs a day against `.factory/`, each with its evidence (E2, PLU-131). | Scorer failures and metrics | PRs for Noah to review |
| Desktop wrapper | A Tauri shell around the web app, replacing the Tauri chat app (I1, PLU-133). | The web app and the server | The same screens on the desktop |

## The loop from issue to merge

A work item moves through the stages `inbox, ready, triage, spec, building, ci-wait, review, done, cancelled`. Beside the stage, a `waiting_on_you` flag says it is waiting on Noah. The board mirrors these to Kira's labels on GitHub: `ready-for-agent`, `agent-working`, `ci-wait`, `needs-info` and `ready-for-human` (vault Architecture `## Contracts`, PLU-103, PLU-104).

1. Intake. An issue Noah labels `ready-for-agent` moves its work item to `ready`; a request from the inbox or the Factory API files a new one (W4, PLU-104, PLU-122, PLU-129).
2. Claim. When memory and a slot are free, the scheduler claims one work item per tick: factory fixes first, then `priority`, then the oldest, skipping any whose `Depends on #N` is still open (PLU-107).
3. Triage and spec. The foreman triages. A feature gets a spec when the project's policy asks for one: a product doc and a technical doc in Kira's feature-doc form, graded by a fresh subagent of the foreman against this page and `docs/technical.md`. Noah approves it before building starts; a fix goes straight to building (W7, PLU-103; Noah, 12 Nov 2026).
4. Build. The engineer works in the work item's own worktree, writes the failing test first, pushes, opens the PR and parks on CI. The scheduler resumes it with the CI result, so no model turn is spent waiting (PLU-107, PLU-109).
5. Review. The reviewer approves or requests changes on the PR's current head (PLU-109).
6. Merge. When CI's newest run of every required workflow is green on that head, the reviewer approved the same head and nothing waits on Noah, the factory squash-merges into `dev` as its GitHub App and the work item is `done` (PLU-105).
7. Release. Promoting `dev` to `main` is Noah's own PR, per project (W5).

A run that dies is resumed up to three times; after that its work item is handed to Noah as `ready-for-human` (PLU-107).

### When an agent is unsure

Every agent follows Kira's rule, in order (W6, PLU-109):

1. Look it up, in Kira's order of precedence: Noah's comments, the design frame, the agreed spec, the issue, then `CONTEXT.md`, these standing docs and the ADRs, then nearby code (Kira research, section 5).
2. Hard stops always go to Noah. `policy.yaml` lists PLU-109's five (secrets, data deletion, auth, licensing and spend) and the ones from Kira's list that apply here: anything on `main`, tags or releases, credentials, token scopes and CI privilege, private data, a schema or stored-data change one revert PR cannot undo, a new screen with no design frame, and any restriction in a comment of Noah's (PLU-109; Kira research, section 5; Noah, 12 Nov 2026).
3. Default and record when the change lands only on `dev`, is conservative or follows a precedent, one small PR can undo it, and the PR stays under the assumption cap in `policy.yaml`. `pluribus assume` stores the default, and the PR lists it (PLU-108).
4. Otherwise hand over.

A handover goes through `pluribus handover` with the question, "My pick" and "If you say nothing"; it is refused without the last two. It posts one comment as the factory's GitHub App, sets `waiting_on_you` and `needs-info`, and pushes to Noah's phone. It also appears in the inbox and in the next daily digest. Noah answers on GitHub or in the inbox. Only a comment from Noah's own GitHub account after the newest handover counts as his reply: it clears `waiting_on_you` and wakes the run. Comments from anyone else, bots and agents included, stay on the issue as information and wake nothing, because a signed webhook proves GitHub sent it, not who wrote it (PLU-108 acceptance, PLU-122, I2).

### How the factory improves itself

- Every run's full trace is kept: prompts, tool calls, outputs and PR links (PLU-130).
- Two judge scorers, `tests-run` and `task-compliance`, grade 10 to 25% of runs, and delivery metrics track claim to merge, handovers, first CI result, restarts, reverts within 7 days and quota per PR (E1, PLU-130).
- A retro agent runs daily and acts once an agent has 25 unreviewed scorer failures or its oldest one is 7 days old. It opens at most three PRs a day against `.factory/` (prompts, skills, model choice), each with its evidence. Noah reviews every one, and nothing is adopted automatically (E2, PLU-131).
- Factory fixes jump the queue (PLU-107), and from PLU-111 on the factory works its own backlog (F1).
- Agents keep no memory between runs at first (E3); lessons reach later runs as merged changes to `.factory/` (E2).

## Not doing

- Merging into `main`, releasing, or tagging. Promotion is Noah's (W5, PLU-105).
- Anthropic OAuth through omp or Pi, or a second account per vendor (A2, PLU-126).
- A ChatGPT plan or Sign in with ChatGPT at launch. Noah has none; it returns if he takes one (A3 as amended, PLU-126).
- Agent memory between runs, at first (E3).
- Other users, team roles or sign-in beyond one token, and a UI or API reachable from the internet (I2).
- Adopting another factory engine (F4), or porting T3 Code's code rather than rebuilding its patterns (planning decision in ADR 0006).
- The Kira Kira look (decision P1).
- Other forges than GitHub; Telegram, email or web push notifications; micro-VMs and remote runners (PLU-104, PLU-108, PLU-127).

## Keeping this current

A PR that adds an Area, removes one, or changes what passes between Areas updates the Areas table in the same PR. The mission, a goal, the story, a principle or a Not doing line changes only on Noah's decision, recorded in the vault Architecture `## Decisions` and in the same PR as the change it allows. A feature doc that conflicts with one raises it as a question for Noah; it does not bend this page. When Noah answers such a question, the answer goes into the sections it affects, dated.
