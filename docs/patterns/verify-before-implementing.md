# Pattern: Verify Before Implementing

**Category**: Development Process
**Problem**: Documentation Drift
**Solution**: Code Review Before Implementation

---

## Problem

Documentation can lag behind or incorrectly describe implementation reality, leading to:
- Wasted time planning "missing" features that exist
- Confusion about project state
- Duplicate work
- Unnecessary implementation

## Solution

Always verify current state before implementation:

### 1. Read Code First
```bash
# Find relevant files
fd "feature-name" src/

# Check implementation
cat src/path/to/file.ts

# Search for related code
grep -r "FeatureName" src/
```

### 2. Run Type Checker
```bash
bun run typecheck
```

Type errors often reveal partially implemented features or integration points.

### 3. Search for TODOs
```bash
grep -r "TODO.*feature" src/
```

TODOs indicate planned but unfinished work.

### 4. Trust Code Over Docs

**Priority Order**:
1. **Source code** - Absolute truth
2. **Type definitions** - API contracts
3. **Tests** - Behavior specifications
4. **Comments** - Developer notes
5. **Documentation** - Best-effort guide

## Workflow

```
User Request → Check Docs → ⚠️ STOP
                                 ↓
                          Read Actual Code First
                                 ↓
                          Verify Current State
                                 ↓
                      ┌─────────┴──────────┐
                      ↓                    ↓
              Already Complete      Actually Missing
                      ↓                    ↓
              Update Docs Only      Proceed with TDD
```

## Examples

### Example 1: Agent Executor (2026-01-28)

**Claimed State** (ROADMAP.md):
> "Stubbed, needs adapter wiring (~2 hours)"

**Actual State** (Code Review):
- ✅ Fully implemented in `agent.executor.ts`
- ✅ Adapter registry integration complete
- ✅ Event streaming implemented
- ⚠️ Had minor type errors

**Action Taken**:
- Fixed type errors (10 minutes)
- Updated documentation
- Saved 2 hours of duplicate work

**Lesson**: "Stubbed" doesn't mean "not implemented"

---

### Example 2: SSE Endpoint (2026-01-28)

**Claimed State** (ROADMAP.md):
> "Not started (~1 hour)"

**Actual State** (Code Review):
- ✅ Complete SSE endpoint at `GET /api/runs/:id/events`
- ✅ Redis pub/sub integration
- ✅ Worker event publishing
- ✅ Keep-alive and cleanup
- ✅ Type-safe, no errors

**Action Taken**:
- Verified completeness (15 minutes)
- Updated documentation
- Saved 1 hour of duplicate work

**Lesson**: "Not started" can mean "not documented"

---

## When NOT to Verify

Skip verification when:
- Greenfield features with no existing code
- New projects with accurate documentation
- Features explicitly confirmed missing by team
- Time-sensitive hotfixes (but document after)

## Cost-Benefit Analysis

| Approach | Time Cost | Risk | Outcome |
|----------|-----------|------|---------|
| **Trust docs** | 0 min | High | May implement duplicate |
| **Verify first** | 10-15 min | Low | Know exact state |
| **Verify + Document** | 20-30 min | Very Low | Accurate knowledge |

**Verdict**: Always verify. 15 minutes saves hours.

## Implementation Checklist

Before implementing any "missing" feature:

- [ ] Read the relevant source files
- [ ] Run type checker
- [ ] Search for TODOs and FIXMEs
- [ ] Check test coverage
- [ ] Verify against documentation claims
- [ ] Update docs if state differs

If feature is complete:
- [ ] Update ROADMAP/documentation
- [ ] Create PDCA cycle documenting discovery
- [ ] Inform team of documentation drift

If feature is truly missing:
- [ ] Proceed with TDD
- [ ] Document as you implement
- [ ] Update ROADMAP progress

## Red Flags

Signs that documentation may be wrong:

🚩 **Outdated timestamps** - "Last updated 6 months ago"
🚩 **Vague status** - "Partially complete", "Mostly done"
🚩 **Conflicting info** - README says done, ROADMAP says not started
🚩 **No code references** - Documentation doesn't link to actual files
🚩 **Suspiciously fast estimates** - "1 hour" for complex features

## Prevention

To reduce documentation drift:

### 1. Document After Implementation
Don't update docs until feature is actually complete.

### 2. Link Docs to Code
```markdown
## SSE Endpoint ✅ Complete
**File**: [`src/api/routes/runs.ts:79-174`](../src/api/routes/runs.ts#L79)
```

### 3. Use PDCA Cycles
Document plan → do → check → act for each feature.

### 4. Regular Audits
Monthly review of ROADMAP vs actual codebase.

### 5. Trust CI/CD
If tests pass and types check, feature is likely complete.

## Related Patterns

- **Test-Driven Development** - Verify behavior through tests
- **Type-Driven Development** - Use type checker as verification
- **Code Review** - Team verification of implementation
- **PDCA Cycle** - Systematic documentation of work

## See Also

- `docs/pdca/agent-executor-wiring/` - First discovery
- `docs/pdca/sse-endpoint-verification/` - Second discovery
- `docs/ROADMAP.md` - Now includes drift warning
