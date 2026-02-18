# PDCA Plan: Enhanced Claude CLI Integration

**Feature**: Enhanced CLI Integration + assistant-ui Improvements
**Date**: 2026-02-11
**Status**: Analysis Complete -- Ready for Implementation
**Source Plan**: `docs/enhanced-cli-integration-plan.md`
**Coordination**: `docs/pdca/enhanced-cli-integration/coordination.md`

---

## Hypothesis (REVISED after expert analysis)

By fixing the missing tool-result emission bug, cleaning up dead session code, and adding structured tool display components, we can significantly improve UX and maintainability. The direct CLI invocation (security) goal is blocked by Tauri's shell plugin but can be addressed with a custom Rust command in a future phase.

## Expected Outcomes (REVISED)

| Metric | Current | Target | Notes |
|--------|---------|--------|-------|
| Tool completion status | **BROKEN** (always "running") | Per-tool running/complete/error | Bug fix: emit `result`/`isError` on content parts |
| Tool visibility | Generic JSON display | Per-tool rich UI (8 tools) | Read, Edit, Write, Bash, Grep, Glob, WebSearch, WebFetch |
| Dead code | ~100 lines of dead session-id code | Removed | Ghost fields, dead branches, schema cleanup |
| Shell security | `sh -c` wrapper | Simplified wrapper (remove dead branch) | Direct invocation blocked by Tauri stdin API |
| Sub-agent display | None | Basic Task tool renderer | Live streaming NOT possible with `claude -p` |
| Session retry steps | Already 2-step | Same (just cleanup) | Plan was outdated -- already simplified |
| Test coverage | 0% | Core functions covered | Vitest for pure functions |

## Risks & Mitigation (REVISED)

| Risk | Impact | Likelihood | Mitigation |
|------|--------|-----------|-----------|
| Tauri stdin closing not supported | Phase 1 blocked for direct invocation | **CONFIRMED** | Keep shell wrapper; future custom Rust command |
| Sub-agent events not available | Phase 3 reduced scope | **CONFIRMED** | Descope to basic Task tool renderer |
| assistant-ui `tools.by_name` API | Phase 2/6 broken | **LOW** (confirmed working) | Verified in source code |
| DB migration for dropping columns | Phase 4 data loss | MEDIUM | Use `ALTER TABLE DROP COLUMN` (SQLite 3.35+) |
| Adding `result` to content parts causes re-renders | Phase 5 UI flicker | LOW | `toMessagePartStatus` handles both cases |

## Revised Phase Dependencies

```
Phase 5 (Bug fix: result/isError) ──── highest value, 30 min
    │
    ├──► Phase 2 (Tool Display Components) ──── major UX, 4-6 hours
    │        │
    │        └──► Phase 6 (Wire into thread) ──── depends on Phase 2, 30 min
    │
    ├──► Phase 3 (Basic Task renderer) ──── descoped, 1-2 hours
    │
Phase 4 (Dead code cleanup) ──── standalone, 1-2 hours
    │
Phase 1 (Shell wrapper simplify) ──── needs stdin test first, 2-4 hours
```

---

## Decision Log

| Date | Decision | Rationale | Expert |
|------|----------|-----------|--------|
| 2026-02-11 | Start analysis phase | Need expert review before implementation | PM |
| 2026-02-11 | Reorder: Phase 5 first | Missing `result`/`isError` is a real bug -- tools never show completion | Back-end |
| 2026-02-11 | Keep shell wrapper for Phase 1 | Tauri shell plugin has no stdin close API | Rust/Tauri |
| 2026-02-11 | Descope Phase 3 | CLI does not emit nested sub-agent events | CLI + Back-end |
| 2026-02-11 | Phase 4 = cleanup only | Session strategy already simplified to 2-step | Back-end |
| 2026-02-11 | Use Vitest for testing | Native to Vite, works with bun, no config overhead | Testing |
| 2026-02-11 | Extract pure functions first | Enable test-first approach without Tauri mocks | Testing |
