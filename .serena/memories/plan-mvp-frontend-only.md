# MVP Frontend - Only Remaining Blocker

**Status**: Backend 100% complete, SSE endpoint verified
**Estimated Time**: 1-2 days
**Priority**: P0 (only blocker to MVP)

## What's Ready

✅ Backend API (all endpoints functional)
✅ Workflow execution engine
✅ SSE endpoint for real-time updates
✅ Redis pub/sub event streaming
✅ Complete database schema

## What's Missing

⚠️ Frontend UI - 3 simple pages

## Implementation Plan

### Page 1: Workflows List (`/`)
- Fetch: `GET /api/workflows`
- Display: Table with name, description, trigger type
- Actions: 
  - "Run" button → `POST /api/workflows/:id/run`
  - Click row → navigate to runs list
- UI: Basic Tailwind styling

### Page 2: Runs List (`/workflows/:id/runs`)
- Fetch: `GET /api/workflows/:workflowId/runs`
- Display: Table with status, timestamps, duration
- Status badges: pending/running/completed/failed
- Actions:
  - Click row → navigate to run detail
  - "New Run" button

### Page 3: Run Detail (`/runs/:id`)
- Fetch: `GET /api/runs/:id`
- Fetch: `GET /api/runs/:id/nodes`
- SSE: Connect to `/api/runs/:id/events`
- Display:
  - Run metadata (workflow, status, times)
  - Node execution timeline (vertical list)
  - Node input/output JSON (expandable)
- Real-time: Update UI when SSE events arrive

## Tech Stack

- **Vite** - Dev server and build
- **React 19** - UI library
- **TypeScript** - Type safety
- **TailwindCSS v4** - Styling
- **React Query** - Data fetching
- **EventSource** - SSE connection

## Success Criteria

✅ Can see all workflows in browser
✅ Can trigger workflow run from UI
✅ Can watch nodes execute in real-time
✅ Can inspect node inputs/outputs
✅ Can see run success/failure status

## Directory Structure

```
frontend/
├── src/
│   ├── api/
│   │   └── client.ts          # Fetch wrapper
│   ├── components/
│   │   ├── StatusBadge.tsx    # Status pill
│   │   ├── DataTable.tsx      # Reusable table
│   │   ├── JsonViewer.tsx     # JSON display
│   │   └── Layout.tsx         # Header + nav
│   ├── pages/
│   │   ├── WorkflowsList.tsx  # Page 1
│   │   ├── RunsList.tsx       # Page 2
│   │   └── RunDetail.tsx      # Page 3
│   ├── App.tsx                # Router
│   └── main.tsx               # Entry point
├── vite.config.ts             # Vite config
└── package.json               # Dependencies
```

## Not in MVP

❌ Workflow creation UI
❌ Agent configuration UI
❌ Complex visualizations
❌ Authentication
❌ Dark mode
❌ Settings pages
❌ State management (just React Query)

## Next Steps

1. Initialize Vite project
2. Install dependencies
3. Setup routing
4. Create API client
5. Build pages 1-3
6. Test SSE connection
7. Style with Tailwind
8. End-to-end test
