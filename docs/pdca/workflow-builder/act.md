# Act: Visual Workflow Builder Frontend

**Feature**: Visual workflow builder improvements and next actions
**Completed**: TBD
**Status**: Not Started (Will be created after evaluation)

---

## Success Pattern → Formalization

### Patterns to Document
(To be identified during implementation and evaluation)

#### Pattern 1: [Pattern Name]
- **Context**: When to use this pattern
- **Solution**: What to do
- **Benefits**: Why it works
- **Location**: Where to document (e.g., `docs/patterns/react-flow-optimization.md`)

#### Pattern 2: [Pattern Name]
- **Context**: TBD
- **Solution**: TBD
- **Benefits**: TBD
- **Location**: TBD

---

## TDD Learnings

### What Worked with TDD

1. **Bug Discovery**: Backfilling tests for workflowBuilderStore revealed an off-by-one error in undo/redo that manual testing missed. The first action couldn't be undone.

2. **Mock Strategy Clarity**: Deciding upfront which components to unit test vs E2E test prevented wasted effort on WorkflowCanvas mocking.

3. **Co-located Tests**: Keeping `*.test.tsx` files next to source files makes navigation easy and ensures tests are updated with code.

4. **Coverage Thresholds**: Setting 70% threshold (configurable in vitest.config.ts) creates healthy pressure without blocking progress.

### What Was Challenging with TDD

1. **Backfilling is harder**: Writing tests after implementation requires understanding existing behavior, not defining new behavior. TDD would have been easier.

2. **React Flow Mocking**: The `@xyflow/react` library has complex internals. Mocking `Handle` component was straightforward, but full canvas testing isn't practical at unit level.

3. **EventSource in jsdom**: Browser APIs need custom mocks. Class-based mock with static instance tracking was the solution.

### TDD Patterns to Reuse

```typescript
// Pattern 1: EventSource mock class
class MockEventSource {
  static instances: MockEventSource[] = []
  constructor(url: string) {
    this.url = url
    MockEventSource.instances.push(this)
  }
  simulateOpen() { this.onopen?.({} as Event) }
  simulateMessage(data: string) { this.onmessage?.({ data } as MessageEvent) }
  simulateError() { this.onerror?.({} as Event) }
}

// Pattern 2: React Flow component mock
vi.mock('@xyflow/react', () => ({
  Handle: ({ type, position, id }) => (
    <div data-testid={`handle-${type}-${position}${id ? `-${id}` : ''}`} />
  ),
  Position: { Top: 'top', Bottom: 'bottom', Left: 'left', Right: 'right' },
}))

// Pattern 3: Zustand store testing
beforeEach(() => {
  useStore.getState().reset()
})
```

### TDD Anti-Patterns Discovered

1. **Testing implementation details**: Early tests checked internal history array structure. Better to test through public API (canUndo, undo, redo).

2. **Regex matching in getByText**: `/all/` matched "Parallel" and "all". Use more specific patterns like `/branches \| all/`.

3. **Skipping E2E decision**: Initially tried to unit test everything. Better to recognize integration-heavy components early and plan for E2E.

---

## Learnings → Global Rules

### CLAUDE.md Updates

#### Update 1: [Topic]
**Rationale**: Why this is important for future work
**Content to Add**:
```markdown
(To be added to CLAUDE.md after implementation)
```

#### Update 2: [Topic]
**Rationale**: TBD
**Content to Add**: TBD

---

## Checklist Updates

### New Feature Checklist
(To be created/updated based on learnings)

**Location**: `docs/checklists/new-feature-checklist.md`

**Items to Add**:
- [ ] (To be determined based on implementation experience)

### Frontend Development Checklist
(To be created/updated based on learnings)

**Location**: `docs/checklists/frontend-development-checklist.md`

**Items to Add**:
- [ ] (To be determined based on implementation experience)

---

## Technical Debt

### Identified During Implementation
(To be documented as discovered)

#### Debt Item 1: [Description]
- **Impact**: High/Medium/Low
- **Effort to Fix**: Hours/Days
- **Priority**: P0/P1/P2/P3
- **Mitigation**: Current workaround
- **Future Plan**: When and how to address

#### Debt Item 2: [Description]
- **Impact**: TBD
- **Effort to Fix**: TBD
- **Priority**: TBD
- **Mitigation**: TBD
- **Future Plan**: TBD

---

## Improvements for Next Implementation

### Process Improvements
(To be documented after project completion)

#### Improvement 1: [Topic]
- **Current Approach**: What we did
- **Issue**: What didn't work well
- **Proposed Change**: What to do differently next time

#### Improvement 2: [Topic]
- **Current Approach**: TBD
- **Issue**: TBD
- **Proposed Change**: TBD

### Technical Improvements
(To be documented after project completion)

#### Improvement 1: [Topic]
- **Current Implementation**: What we built
- **Limitation**: What could be better
- **Enhancement**: How to improve

#### Improvement 2: [Topic]
- **Current Implementation**: TBD
- **Limitation**: TBD
- **Enhancement**: TBD

---

## Future Features (Out of Scope for MVP)

### High Priority (Next Iteration)
1. **Workflow Versioning UI**
   - **Why**: Users need to track changes over time
   - **Effort**: 5 days
   - **Dependencies**: Backend versioning support
   - **Value**: High - enables rollback and audit trail

2. **Canvas Minimap**
   - **Why**: Navigation in large workflows
   - **Effort**: 1 day
   - **Dependencies**: None
   - **Value**: Medium - nice QoL improvement

3. **Export/Import JSON**
   - **Why**: Workflow portability and backup
   - **Effort**: 2 days
   - **Dependencies**: None
   - **Value**: Medium - enables sharing and migration

### Medium Priority
4. **Node Search/Filter in Palette**
   - **Why**: Faster node discovery
   - **Effort**: 1 day
   - **Dependencies**: None
   - **Value**: Low - only useful with many node types

5. **Collaborative Editing (WebSocket)**
   - **Why**: Multiple users editing simultaneously
   - **Effort**: 10 days
   - **Dependencies**: Backend WebSocket support, conflict resolution
   - **Value**: High - but complex implementation

### Low Priority (Future)
6. **Workflow Analytics Dashboard**
7. **AI-Assisted Workflow Generation**
8. **Workflow Marketplace/Sharing**

---

## Mistakes → Prevention

### Mistake 1: [Description]
(To be documented if mistakes occur)

- **What Happened**: Description of the error
- **Root Cause**: Why it happened (with evidence)
- **Impact**: What broke, how long to fix
- **Prevention Checklist**:
  - [ ] Check for [X] before [Y]
  - [ ] Validate [Z] assumption
  - [ ] Test [A] scenario
- **Documentation**: `docs/mistakes/workflow-builder-[topic]-YYYY-MM-DD.md`

### Mistake 2: [Description]
- **What Happened**: TBD
- **Root Cause**: TBD
- **Impact**: TBD
- **Prevention Checklist**: TBD
- **Documentation**: TBD

---

## Action Items

### Immediate (Before Production Deploy)
- [ ] (To be determined based on implementation and testing)

### Short Term (Within 1 Month)
- [ ] (To be determined based on user feedback)

### Long Term (3-6 Months)
- [ ] (To be determined based on roadmap)

---

## Knowledge Base Updates

### Documentation to Create
1. **User Guide**: `docs/user-guide/visual-workflow-builder.md`
   - How to create workflows
   - Node types explanation
   - Keyboard shortcuts
   - Best practices

2. **Developer Guide**: `docs/developer-guide/workflow-builder-architecture.md`
   - Component structure
   - State management
   - React Flow integration
   - Adding new node types

3. **Troubleshooting Guide**: `docs/troubleshooting/workflow-builder.md`
   - Common issues
   - SSE connection problems
   - Validation errors
   - Performance optimization

### Documentation to Update
1. **README.md**: Add workflow builder section
2. **CLAUDE.md**: Add frontend patterns and conventions
3. **API Documentation**: Ensure workflow APIs documented

---

## Success Metrics Tracking Plan

### Ongoing Metrics (Post-Launch)
1. **User Adoption**
   - % of workflows created via UI vs API
   - Average workflows created per user
   - User retention after first workflow

2. **Performance Monitoring**
   - P95 render time for workflows
   - SSE connection stability
   - Error rate by browser

3. **Quality Metrics**
   - Invalid workflow submission rate
   - User-reported bugs per week
   - Undo/redo usage frequency

### Monitoring Implementation
- **Location**: Add to observability system
- **Alerts**: Set up for SSE disconnections, high error rates
- **Dashboards**: Create in Grafana/similar tool

---

## Retrospective Questions (To Be Answered)

### What Would We Do Differently?
1. TBD after implementation

### What Would We Do the Same?
1. TBD after implementation

### What Surprised Us?
1. TBD after implementation

### What Would We Avoid?
1. TBD after implementation

---

## Next Steps After This Feature

### Immediate Follow-Up
(To be determined after completion)

### Related Features
(To be determined based on user needs)

---

## Notes

This document will be completed after:
1. Implementation is finished (`do.md` complete)
2. Evaluation is done (`check.md` complete)
3. Patterns and learnings are identified
4. User feedback is collected (if applicable)

The Act phase is about continuous improvement and knowledge capture for future work.
