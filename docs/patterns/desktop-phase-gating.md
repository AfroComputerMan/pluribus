# Pattern: Desktop Phase Gating

**Category**: Delivery Process  
**Problem**: Large desktop pivots look "done" in code but remain unshippable because integration gates are implicit.  
**Solution**: Mark a phase complete only when executable validation gates pass.

---

## Why This Exists

Desktop pivots combine multiple runtimes (Rust + frontend + tooling + assets).  
Checklist completion is not enough: one missing build asset can block the entire phase.

---

## Gate Definition

For each phase, define and run concrete commands:

1. `Implementation gate`: required files/modules exist and are wired.
2. `Verification gate`: tests and compile checks pass.
3. `Runtime gate`: app path works end-to-end for the phase objective.
4. `Documentation gate`: PDCA and pattern docs reflect actual status, including blockers.

---

## Recommended Commands (Phase 1 Example)

```bash
# Parser/transform logic
bun test src/lib/ndjson-parser.test.ts

# Rust code health independent of bundle assets
cd src-tauri && cargo check --lib

# Full binary check (requires icons/assets)
cd src-tauri && cargo check
```

If the final runtime gate fails, phase status is `In Progress`, not `Complete`.

---

## PDCA Rule

- `do.md`: mark task checkboxes based on implemented code.
- `check.md`: mark gate pass/fail based on command output.
- `act.md`: record blockers as technical debt with mitigation and next action.

---

## Anti-Patterns

- Declaring phase complete when only static code exists.
- Recording "TBD" after commands were already run.
- Mixing backend and desktop typechecks without runtime boundaries.

---

## Expected Outcome

- Less documentation drift.
- Faster handoffs between phases.
- Fewer "almost done" states that hide integration risk.
