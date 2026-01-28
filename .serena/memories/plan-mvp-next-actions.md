# Next Actions for MVP

**Goal**: Complete minimal viable product with visual feedback in browser
**Timeline**: 2 days of focused work remaining
**Current**: Backend 100% complete, need UI + real-time updates

## Immediate Next Steps (In Priority Order)

### Step 1: Backend SSE Endpoint (~1 hour)
**File**: `src/api/routes/runs.ts`
**Priority**: P0 (blocks real-time UI)

**Implementation**:
```typescript
// Add new endpoint:
GET /api/runs/:id/events

Tasks:
- Connect to Redis pub/sub
- Subscribe to run:{runId} channel
- Forward events to SSE client
- Handle disconnect cleanup
- Set proper headers (text/event-stream, etc.)
```

**Acceptance Criteria**:
- Can curl endpoint and receive events in real-time
- Connection stays open until client disconnects
- Proper error handling for invalid run IDs

**Events to Stream**: node:started, node:output, node:completed, run:completed, run:failed

---

### Step 2: MVP Frontend Setup (~2-3 hours)
**Directory**: `/home/user/projects/pluribus/frontend/`
Tasks: Vite + React + TypeScript + TailwindCSS + React Query + routing

### Step 3: Implement MVP UI Pages (~4-6 hours)
Pages: WorkflowsList, RunsList, RunDetail with real-time SSE updates

### Step 4: End-to-End Test (~1 hour)
Verify complete flow from browser to execution
