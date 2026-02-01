# Plan: Visual Workflow Builder Frontend

## Hypothesis
Build comprehensive visual workflow builder using React Flow for DAG editing, enabling users to create workflows via drag-and-drop instead of manual JSON/API manipulation.

## Architecture Decisions

### Technology Choices
1. **React Flow** - Industry standard for node-based UIs, excellent docs, good TypeScript support
2. **Zustand** - Lightweight state management for builder (better than Redux for this use case)
3. **Dagre** - Automatic graph layout algorithm (hierarchical top-to-bottom)
4. **TanStack React Query** (existing) - Server state management
5. **TailwindCSS v4** (existing) - Styling consistency
6. **Vitest** - Testing framework with React Testing Library

### Key Technical Approaches
1. **State Management**: Zustand for builder canvas state (nodes/edges/history), React Query for server state
2. **Auto-Layout**: Dagre on initial load, manual override supported via drag
3. **Real-time Updates**: SSE via useWorkflowEvents hook (replace polling entirely)
4. **Validation**: Client-side Zod validation + Kahn's algorithm for cycle detection
5. **Undo/Redo**: History stack in Zustand store with index tracking (bug fixed: now starts with initial state)
6. **Testing**: TDD mandatory, 85% coverage for validation, E2E for WorkflowCanvas

## Current Status (2026-02-01)
- ✅ Phase 1: Foundation (committed, tested)
- ✅ Phase 2: Core Canvas (committed, tested)
- ✅ Phase 3: Configuration (implemented, 88%+ coverage)
- ✅ Phase 4: Save/Publish workflows (committed)
- ✅ Phase 5: Execution Visualization (committed, 39 new tests)
  - ExecutionOverlay: Read-only React Flow canvas with status visualization
  - NodeExecutionModal: Detailed node execution view
  - ExecutionPage: Full SSE integration with real-time updates
  - Navigation: "Visualize" button on RunDetailPage
  - Fixed: vite.config.ts path aliases
  - 314 total tests passing
- ⏳ Phase 6-10: Remaining phases

## Phase 5 Components Completed
- ExecutionOverlay.tsx - Visual workflow execution canvas
- NodeExecutionModal.tsx - Node execution detail modal
- ExecutionPage.tsx - Full execution visualization page
- Route: /runs/:id/visualize

## Expected Outcomes
- **User Experience**: Drag-and-drop workflow creation (80% faster than API/JSON)
- **Real-time Feedback**: Instant execution visualization via SSE
- **Mobile Support**: Responsive design works on tablets/phones
- **Quality**: Validation prevents invalid workflows, undo/redo prevents mistakes
- **Extensibility**: Agent/MCP management enables advanced configurations
- **Reliability**: 314+ tests ensure correctness

## Success Criteria (MVP Must-Haves)
✅ Visual builder with drag-and-drop
✅ All 5 node types supported (100% test coverage)
✅ Node configuration with validation
✅ Save/load workflows
✅ Real-time execution visualization
✅ SSE integration (100% test coverage)
✅ Auto-layout + manual override (100% test coverage)
✅ Undo/redo (100% test coverage, bug fixed)
⏳ Agent/MCP management
⏳ Mobile responsive
⏳ Docker resource controls per node

## Implementation Strategy
**Wave Pattern** - 10 sequential phases with quality gates + TDD:
1. Foundation ✅ (tested)
2. Core canvas ✅ (tested)
3. Configuration ✅ (tested - 88%+ coverage)
4. Save/publish ✅ (tested - 275 tests passing)
5. Execution visualization ✅ (tested - 314 tests passing)
6. Docker monitoring (next)
7. Agent/MCP management
8. Responsive design
9. UX enhancements
10. Testing & polish (E2E for WorkflowCanvas)
