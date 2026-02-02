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

## Current Status (2026-02-02)
- ✅ Phase 1: Foundation (committed, tested)
- ✅ Phase 2: Core Canvas (committed, tested)
- ✅ Phase 3: Configuration (implemented, 88%+ coverage)
- ✅ Phase 4: Save/Publish workflows (committed, tested)
- ✅ Phase 5: Execution Visualization (committed, tested)
- ✅ Phase 6: Docker Execution Monitoring (committed, 444 tests)
- ✅ Phase 7: MCP Tools Management (committed, 20 new tests)
  - MCP API client with typed endpoints (servers, tools, discover, scan)
  - McpToolsPage with server listing, enabled/disabled badges
  - Tool discovery trigger and results display
  - Toggle tool enabled state
  - Scan all servers functionality
  - Search/filter capability
- ⏳ Phase 8: Responsive Design (not started)
- ✅ Phase 9: UX Enhancements (committed, 37 new tests)
  - useKeyboardShortcuts hook (Ctrl+S, Delete, Ctrl+Z, Ctrl+Shift+Z, Esc, Ctrl+D)
  - Store extensions: duplicateNode(), clearSelection()
  - WorkflowTemplatesPage with 5 pre-built workflow examples
  - Template preview modal with node list
- ⏳ Phase 10: Testing & Polish (not started)

**Total: 501 tests passing**

## Phase 7 Components Completed
- McpToolsPage.tsx - MCP server/tool management UI
- api/client.ts - MCP types and methods
- Route: /mcp

## Phase 9 Components Completed
- useKeyboardShortcuts.ts - Keyboard shortcuts hook
- WorkflowTemplatesPage.tsx - 5 pre-built workflow templates
- Route: /templates
- Store: duplicateNode(), clearSelection()

## Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| Ctrl/Cmd+S | Save workflow |
| Delete/Backspace | Delete selected node |
| Ctrl/Cmd+Z | Undo |
| Ctrl/Cmd+Shift+Z / Ctrl+Y | Redo |
| Escape | Deselect node |
| Ctrl/Cmd+D | Duplicate selected node |

## Workflow Templates
1. **Simple Agent Pipeline** - Sequential chain of agents
2. **Conditional Routing** - True/false branching
3. **Parallel Processing** - Concurrent execution with join
4. **Review Workflow** - Human-in-loop approval
5. **Data Processing Loop** - Iteration patterns

## Expected Outcomes
- **User Experience**: Drag-and-drop workflow creation (80% faster than API/JSON)
- **Real-time Feedback**: Instant execution visualization via SSE
- **Mobile Support**: Responsive design works on tablets/phones (Phase 8)
- **Quality**: Validation prevents invalid workflows, undo/redo prevents mistakes
- **Extensibility**: Agent/MCP management enables advanced configurations
- **Reliability**: 501+ tests ensure correctness

## Success Criteria (MVP Must-Haves)
✅ Visual builder with drag-and-drop
✅ All 5 node types supported (100% test coverage)
✅ Node configuration with validation
✅ Save/load workflows
✅ Real-time execution visualization
✅ SSE integration (100% test coverage)
✅ Auto-layout + manual override (100% test coverage)
✅ Undo/redo (100% test coverage, bug fixed)
✅ Agent/MCP management
✅ Keyboard shortcuts
✅ Workflow templates
⏳ Mobile responsive (Phase 8)
⏳ Docker resource controls per node (Phase 10)

## Implementation Strategy
**Wave Pattern** - 10 sequential phases with quality gates + TDD:
1. Foundation ✅ (tested)
2. Core canvas ✅ (tested)
3. Configuration ✅ (tested - 88%+ coverage)
4. Save/publish ✅ (tested)
5. Execution visualization ✅ (tested)
6. Docker monitoring ✅ (tested)
7. MCP management ✅ (tested - 20 new tests)
8. Responsive design ⏳ (next)
9. UX enhancements ✅ (tested - 37 new tests)
10. Testing & polish ⏳ (E2E for WorkflowCanvas)
