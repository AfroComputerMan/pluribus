# Plan: Phase 5 - Real-Time Execution Visualization

**Feature**: Visual workflow execution monitoring with SSE updates
**Started**: 2026-02-01
**Status**: Planning

---

## Hypothesis

### Problem Statement
Users can trigger workflow runs but lack visual feedback during execution. The current RunDetailPage shows a list-based view, not a visual DAG representation.

### Proposed Solution
Build an ExecutionOverlay component that:
1. Displays workflow as read-only React Flow canvas
2. Color-codes nodes by execution status (pending/running/completed/failed)
3. Updates in real-time via SSE events
4. Shows execution details on node click

### Why This Approach?
- **Reuse existing infrastructure**: useWorkflowEvents hook already handles SSE
- **Read-only overlay**: Prevents accidental edits during execution
- **Color coding**: Immediate visual feedback on progress
- **Modal details**: Non-disruptive way to inspect node results

---

## Implementation Tasks

### 5.1 ExecutionOverlay Component
**File**: `frontend/src/components/workflow/ExecutionOverlay.tsx`
- Read-only React Flow canvas (no drag, no connect)
- Load workflow definition + current run state
- Map node statuses to visual styles
- Show connection status indicator

### 5.2 Node Status Styling
**Approach**: Extend existing node components with status prop
- `pending`: Gray border, dimmed
- `running`: Blue border, pulse animation
- `completed`: Green border
- `failed`: Red border
- Duration badge on completed/failed nodes

### 5.3 NodeExecutionModal Component
**File**: `frontend/src/components/workflow/NodeExecutionModal.tsx`
- Fetch node execution data
- Display input/output JSON
- Show error details for failed nodes
- Execution timestamps and duration

### 5.4 ExecutionPage Integration
**File**: `frontend/src/pages/ExecutionPage.tsx`
- Route: `/runs/:id/visualize`
- Combines ExecutionOverlay + NodeExecutionModal
- SSE subscription via useWorkflowEvents

---

## Acceptance Criteria

- [ ] Can navigate to execution visualization from run detail
- [ ] Nodes update colors in real-time via SSE
- [ ] Clicking node shows execution details modal
- [ ] Can see error details for failed nodes
- [ ] Shows execution duration per node
- [ ] Connection status indicator visible

---

## Quality Gates

- Unit tests for ExecutionOverlay (node status mapping)
- Unit tests for NodeExecutionModal (data display)
- Tests written BEFORE implementation (TDD)
- TypeScript compiles without errors
- All existing 275 tests still pass

---

## Dependencies

### Existing Infrastructure (Ready)
- `useWorkflowEvents` hook - SSE connection
- `useSSE` hook - Base SSE functionality
- Custom node components (AgentNode, etc.)
- WorkflowCanvas - React Flow setup
- api.nodeRuns.list() - Fetch node executions

### API Endpoints (Backend)
- `GET /api/runs/:id` - Run details
- `GET /api/runs/:id/events` - SSE stream
- `GET /api/runs/:id/nodes` - Node executions
