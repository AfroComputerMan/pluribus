---
phase: 1
slug: provider-abstraction
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-05
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None configured (type-check only) |
| **Config file** | tsconfig.json (strict mode enabled) |
| **Quick run command** | `tsc --noEmit` |
| **Full suite command** | `bun run build` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `tsc --noEmit`
- **After every plan wave:** Run `bun run build`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 1 | PROV-01 | type-check | `tsc --noEmit` | N/A | ⬜ pending |
| 01-02-01 | 02 | 1 | PROV-02 | type-check + manual | `tsc --noEmit` | N/A | ⬜ pending |
| 01-03-01 | 03 | 1 | PROV-03 | type-check + manual | `tsc --noEmit` | N/A | ⬜ pending |
| 01-04-01 | 04 | 2 | PROV-04 | manual | Manual: spawn agent, check DB | N/A | ⬜ pending |
| 01-05-01 | 05 | 2 | PROV-05 | manual | Manual: kill app, restart, verify | N/A | ⬜ pending |
| 01-06-01 | 06 | 3 | PROV-06 | build | `bun run build` | N/A | ⬜ pending |
| 01-07-01 | 07 | 3 | PROV-07 | manual | Manual: verify config isolation | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

*Existing infrastructure covers all phase requirements. No test framework install needed — validation uses TypeScript strict mode (`tsc --noEmit`) and `bun run build` for type-check + bundle verification.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Agent SDK provider streams output | PROV-02 | Requires live Agent SDK sidecar + API key | Start agent with Claude model, verify streaming text appears in UI |
| Codex provider streams output | PROV-03 | Requires live Codex app-server + API key | Start agent with Codex model, verify streaming text appears in UI |
| PID tracking in SQLite | PROV-04 | Requires inspecting SQLite DB during runtime | Spawn agent, query `active_processes` table, verify PID entry exists |
| Orphan cleanup on startup | PROV-05 | Requires simulating crash scenario | Kill app mid-run, restart, verify stale PIDs are cleaned up |
| Per-agent config isolation | PROV-07 | Requires verifying environment variable behavior | Start two agents, verify CLAUDE_CONFIG_DIR is set differently per config |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
