# Pluribus becomes a server-hosted software factory

**Status:** accepted (2026-11-12, Noah's decision-site answers and his amendments the same day)

**Supersedes in part:** [ADR 0001](0001-backend-language.md), [ADR 0002](0002-sandbox-as-safety-boundary.md), [ADR 0003](0003-rust-authoritative-orchestration.md)

## Context & Decision

Until now Pluribus has been a Tauri 2 desktop chat app over coding agents: a React UI, a Rust backend that owns agent lifecycle, SQLite in the app, and a Pi backend POC with one agent per Docker sandbox ([README](../../README.md), [CONTEXT.md](../../CONTEXT.md)). Its January version was a server workflow engine, deleted on 2026-02-08 and still in git at `5390738` (vault, Research/Pluribus Audit).

Noah's Kira factory has meanwhile proved a different shape on the host: an always-on loop that turns GitHub issues into PRs merged into `dev`, with each agent a T3 Code thread in its own git worktree. From 2026-10-20 to 2026-11-11 it claimed 240 issues and merged 197 PRs, none reverted within 7 days. What broke was the plumbing around the agents (shared state in GitHub labels, one shared GitHub identity, memory and process caps, FUSE worktrees), and Noah's reply time was the longest wait: a median 1.9 h from claim to merge with no handover against 40.7 h after one (vault, Research/Kira Factory and Kira Kira Design, sections 6, 8 and 9).

We will restructure Pluribus in place into a self-hosted software factory. A TypeScript server on Bun runs on the host, reads each project's `.factory/` folder, and moves GitHub issues through stages until each becomes a PR merged into `dev`. A foreman triages and writes the spec, an engineer builds in its own worktree, and a reviewer approves. Agents run on Claude Code, the official `claude` binary under Noah's login. Noah supervises from a web app that installs on his phone and from a Tauri wrapper on his desktop.

## The decisions this records

Noah's answers, as locked in the vault note Reference/Architecture `## Decisions` on 2026-11-12. The docs cite them by id.

| Id | Decision |
|---|---|
| P1 | "Start like Kira Kira" means the Kira factory loop, the process, not the Kira Kira look |
| F1 | Ordinary omp sessions build v0 until Pluribus works one issue end to end (PLU-111); then the factory works its own backlog |
| F2 | Pluribus is the first project; Kira moves over once Pluribus matches Kira's baseline (PLU-132) |
| F3 | Restructure the Pluribus repo in place |
| F4 | Build the engine in Pluribus, borrowing designs |
| F5 | T3 first behind a driver interface; own runner and thread view later |
| F6 | TypeScript on Bun |
| F7 | Config as files in git, runtime state in SQLite |
| A1 | Harnesses: Claude Code (the `claude` binary) by default; omp for local models and API keys; a `codex` driver kept (amended 2026-11-12) |
| A2 | Strict: Claude only through the official `claude` binary under Noah's login |
| A3 | Providers at launch: Claude Max through `claude`, API keys as overflow, local models on the host; no ChatGPT plan (amended 2026-11-12) |
| A4 | Four to six agents at once, idle ones hibernated |
| A5 | A worktree plus a container per writing agent; read-only agents share one container |
| W1 | Pluribus owns the board, mirrored to GitHub labels |
| W2 | `.factory/` in each project repo; a shared library in Pluribus |
| W3 | Warp's file layout, extended |
| W4 | Intake: GitHub events, cron, signed webhooks, a UI request box, an API and an MCP endpoint |
| W5 | Merge into `dev` after CI and review; `main` stays Noah's, per project |
| W6 | Kira's rule when unsure: look it up, default and record, or hand over |
| W7 | Spec approval for features, not fixes, set per project |
| W8 | ntfy push and a daily digest |
| E1 | Delivery metrics plus one or two judge scorers |
| E2 | A scheduled retro agent opens PRs against `.factory/`; Noah approves them |
| E3 | No agent memory at first |
| I1 | One React web app, installable on the phone, with a Tauri wrapper for desktop |
| I2 | Private network only with one token; only webhook paths go through a tunnel |
| I3 | Console layout in Pluribus's own palette, `docs/design-language.md` (palette amended 2026-11-12) |
| I4 | v1 screens: inbox, board, live agent session, runners and capacity, evals and metrics |
| UI | The UI takes T3 Code's way of presenting agents: the chat timeline, work log, composer, status and layout |

Three planning decisions sit beside these, made in the omp planning session the same day: T3's patterns are rebuilt on Pluribus's React and assistant-ui stack, not ported (Noah can overrule); the merge target is a new `dev` branch cut from `main`, leaving the stale `develop` alone; and tests live in `tests/` inside each app or package.

## Why

- The loop works in Kira; its failures are in plumbing that a server can own: claims, capacity, merges and a store that is not GitHub labels (Kira research, section 9).
- Pluribus is a desktop chat app, and a factory needs a server at its centre (decision site, F3).
- No open-source factory covers the whole target, so the engine is built here and designs are borrowed from Warp Factories, Kira's factory, T3 Code and omp (F4).
- TypeScript on Bun because the agents, the UI and the tooling around them are already TypeScript, and Noah wants the server easy to read and manage (F6).
- Anthropic's legal page names only its own binary for using a Claude plan login outside its apps, so Claude runs through `claude` and nothing else (decision site, A1 and A2).

## What it supersedes

- **ADR 0001, in part.** The backend is no longer Rust inside Tauri. The server is TypeScript on Bun in `apps/server`, and Tauri survives only as the desktop wrapper in `apps/desktop` (PLU-133). The Go/Wails question no longer applies.
- **ADR 0003, in part.** The rule that one long-lived process is the source of truth and the UI is a view still holds. That process is now the server on the host, with state in its SQLite store, not the Rust backend of a desktop app.
- **ADR 0002, in part.** The container is still the safety boundary for an agent that writes code (A5). The isolation unit for code changes becomes a git worktree per work item, cut from a clone pool on local disk (PLU-106), not a per-agent Clone. The consequence ADR 0002 left open, controlling what leaves the box, is now answered by a GitHub App identity, a merge gate plus branch protection on `dev`, a container egress allowlist and no tokens inside the sandbox (vault Architecture `## Security`; PLU-104, PLU-105, PLU-127).

ADR 0004 and ADR 0005 are left as they are. Nothing in the plan builds a Repo image by model or drives `pi --mode rpc`; they apply again only if that work returns.

## Consequences

- `CONTEXT.md` gains the factory's terms. Its older entries (Agent, Harness, Orchestrator, Clone) describe the desktop app and are flagged there, not reworded.
- The repo is restructured as a Bun workspace with `apps/server`, `apps/web`, `apps/desktop` and `packages/factory-schema` (PLU-101). `src-tauri/`, `sidecar/` and the legacy Claude Agent SDK and Codex providers are removed once the web app and wrapper replace them (PLU-133).
- Until Pluribus's own drivers land (PLU-127), agents run as T3 threads inside T3's container on the host, so a writing agent has its own worktree but not its own container. A5 is met only from PLU-127.
- The standing docs [`docs/product.md`](../product.md) and [`docs/technical.md`](../technical.md) describe the factory and are checked against these decisions.
