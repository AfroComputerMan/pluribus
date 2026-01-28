# Session Plan: MVP Frontend Implementation

**Started**: 2026-01-28
**Goal**: Complete minimal viable frontend with 3 pages and real-time SSE updates
**Estimated Time**: 6-9 hours total

## Hypothesis

Frontend is the ONLY blocker to MVP. Backend is 100% complete with working SSE endpoint. Building 3 simple pages with basic Tailwind styling should provide sufficient visual feedback to validate the entire system works end-to-end.

## Approach

**Tech Stack**:
- Vite (fast dev server, minimal config)
- React 19 (latest, already in use)
- TypeScript (type safety with backend)
- TailwindCSS v4 (rapid styling)
- React Query (data fetching, no complex state management)
- EventSource API (native SSE support)

**Scope**:
- MVP = Functional over pretty
- Basic Tailwind styling (no custom design system yet)
- 3 pages only: WorkflowsList, RunsList, RunDetail
- No workflow creation UI (use API/curl)
- No authentication (post-MVP)

## Implementation Steps

1. **Initialize Project** (~30 min)
   - Create frontend/ directory
   - Vite + React + TS setup
   - Install dependencies
   - Configure Vite proxy to backend

2. **Project Structure** (~1 hour)
   - API client with type-safe fetch wrapper
   - React Router with 3 routes
   - Tailwind configuration
   - Base layout component

3. **Page 1: WorkflowsList** (~1.5 hours)
   - Fetch workflows, display table
   - Run button with loading state
   - Navigation to runs list
   - Basic error handling

4. **Page 2: RunsList** (~1.5 hours)
   - Fetch runs for workflow
   - Status badges with color coding
   - Timestamp and duration display
   - Navigation to run detail

5. **Page 3: RunDetail** (~2 hours)
   - Run metadata display
   - Node execution timeline
   - SSE connection for real-time updates
   - JSON viewer for inputs/outputs
   - Auto-update UI on events

6. **Components** (~1 hour)
   - StatusBadge (reusable colored pill)
   - DataTable (generic table)
   - JsonViewer (collapsible JSON)
   - Layout (header + container)

7. **E2E Test** (~1 hour)
   - Create test workflow
   - Trigger from UI
   - Verify real-time updates
   - Check output display

## Success Criteria

✅ `make frontend-dev` starts dev server
✅ Can see all workflows in browser
✅ Can trigger workflow run with button click
✅ Can watch nodes execute in real-time
✅ Can inspect node inputs/outputs as JSON
✅ Can see run success/failure status

## Risks & Mitigation

**Risk**: SSE connection issues with CORS
**Mitigation**: Vite proxy configured to backend, same-origin requests

**Risk**: Type mismatches between frontend/backend
**Mitigation**: Reference backend types, validate with actual API calls

**Risk**: React Query cache invalidation complexity
**Mitigation**: Manual refetch on mutations, keep it simple for MVP

## Next Action

Starting with task 1: Initialize Vite project
