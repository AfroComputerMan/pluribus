---
phase: 2
slug: agent-registry-and-lifecycle
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-06
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 3.x |
| **Config file** | `vitest.config.ts` (Wave 0 — must create) |
| **Quick run command** | `bunx vitest run --reporter=verbose` |
| **Full suite command** | `bunx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `bunx vitest run --reporter=verbose`
- **After every plan wave:** Run `bunx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-01 | 01 | 0 | ORCH-01 | unit | `bunx vitest run tests/agent-registry.test.ts -t "spawn"` | ❌ W0 | ⬜ pending |
| 02-01-02 | 01 | 0 | ORCH-02 | unit | `bunx vitest run tests/concurrency-governor.test.ts -t "limit"` | ❌ W0 | ⬜ pending |
| 02-01-03 | 01 | 0 | ORCH-03 | unit | `bunx vitest run tests/status-transitions.test.ts` | ❌ W0 | ⬜ pending |
| 02-01-04 | 01 | 0 | PERS-03 | unit | `bunx vitest run tests/write-serializer.test.ts` | ❌ W0 | ⬜ pending |
| 02-02-01 | 02 | 1 | ORCH-01 | unit | `bunx vitest run tests/agent-registry.test.ts -t "spawn"` | ❌ W0 | ⬜ pending |
| 02-02-02 | 02 | 1 | ORCH-01 | unit | `bunx vitest run tests/agent-registry.test.ts -t "restart"` | ❌ W0 | ⬜ pending |
| 02-02-03 | 02 | 1 | ORCH-02 | unit | `bunx vitest run tests/concurrency-governor.test.ts -t "promote"` | ❌ W0 | ⬜ pending |
| 02-02-04 | 02 | 1 | ORCH-02 | unit | `bunx vitest run tests/concurrency-governor.test.ts -t "cancel"` | ❌ W0 | ⬜ pending |
| 02-03-01 | 03 | 2 | ORCH-03 | unit | `bunx vitest run tests/agent-status-store.test.ts` | ❌ W0 | ⬜ pending |
| 02-03-02 | 03 | 2 | ORCH-08 | unit | `bunx vitest run tests/agent-registry.test.ts -t "cwd"` | ❌ W0 | ⬜ pending |
| 02-04-01 | 04 | 3 | PERS-01 | integration | `bunx vitest run tests/agent-persistence.test.ts` | ❌ W0 | ⬜ pending |
| 02-04-02 | 04 | 3 | PERS-02 | integration | `bunx vitest run tests/db-wal.test.ts` | ❌ W0 | ⬜ pending |
| 02-04-03 | 04 | 3 | PERS-03 | unit | `bunx vitest run tests/write-serializer.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest.config.ts` — Vitest configuration with path aliases matching tsconfig
- [ ] `tests/concurrency-governor.test.ts` — Governor unit test stubs (TDD: write first)
- [ ] `tests/status-transitions.test.ts` — Status FSM test stubs (TDD: write first)
- [ ] `tests/write-serializer.test.ts` — Write queue test stubs (TDD: write first)
- [ ] `tests/agent-registry.test.ts` — Registry test stubs (TDD: write first)
- [ ] `tests/agent-status-store.test.ts` — Zustand store test stubs
- [ ] `tests/agent-persistence.test.ts` — Persistence integration test stubs
- [ ] `tests/db-wal.test.ts` — WAL mode verification test stubs
- [ ] `bun add -d vitest` — Install Vitest framework

*Existing infrastructure covers no test requirements — full Wave 0 setup needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Native directory picker dialog | ORCH-08 | Requires Tauri desktop runtime + OS dialog | 1. Click "New Agent" 2. Verify native OS file picker opens 3. Select directory 4. Verify path stored |
| Toast notifications on queue/dequeue | ORCH-02 | UI notification visual verification | 1. Spawn 5 agents 2. Spawn 6th 3. Verify "queued" toast 4. Kill one 5. Verify "started" toast |
| Error badge display in sidebar | ORCH-03 | Visual UI verification | 1. Force agent error 2. Verify status badge shows in thread list |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
