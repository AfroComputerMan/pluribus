# Plan: Visual Workflow Builder Frontend

**Feature**: Comprehensive visual workflow builder with drag-and-drop DAG editor
**Timeline**: 26 development days (10 phases)
**Started**: 2026-01-28
**Status**: Planning Phase

---

## Hypothesis

### Problem Statement
Current state: Pluribus has a robust backend workflow engine but users must create workflows via API/JSON. This is error-prone and requires technical expertise.

### Proposed Solution
Build a visual workflow builder using React Flow that enables:
1. **Drag-and-drop workflow creation** - Intuitive node placement and connection
2. **Real-time execution visualization** - Watch workflows execute via SSE
3. **Complete node configuration** - Forms for all 5 node types with validation
4. **Agent/MCP management** - UI for configuring agents and tools
5. **Mobile responsiveness** - Works on tablets and phones

### Why This Approach?

**Technology Choices**:
- **React Flow**: Industry standard for node-based UIs, 20k+ GitHub stars, excellent TypeScript support, built-in touch gestures
- **Zustand**: Lightweight state management (3KB), simpler than Redux, perfect for canvas state
- **Dagre**: Battle-tested graph layout algorithm, hierarchical layouts
- **SSE (existing)**: Already implemented in backend, eliminates polling overhead
- **TailwindCSS v4 (existing)**: Maintains styling consistency with existing MVP

**Architecture Rationale**:
1. **State Management Strategy**:
   - Zustand for builder canvas (nodes, edges, selection, history)
   - React Query for server state (workflows, runs, agents)
   - Separation of concerns: local UI state vs server data

2. **Auto-Layout + Manual Override**:
   - Dagre provides instant organization on load
   - Users can manually reposition for custom layouts
   - Best of both worlds: automation + control

3. **Real-time Updates via SSE**:
   - Backend already publishes events to Redis
   - Frontend SSE hook subscribes to run events
   - Zero polling, instant UI updates

4. **Validation Strategy**:
   - Client-side: Zod schemas for forms, Kahn's algorithm for cycles
   - Server-side: Backend validates on save (defense in depth)
   - Validate on save, not on every edit (performance)

5. **Undo/Redo Implementation**:
   - History stack in Zustand with index tracking
   - Push state on node add/delete/update, edge add/delete
   - Keyboard shortcuts (Ctrl+Z, Ctrl+Shift+Z)

---

## Expected Outcomes (Quantitative)

### User Experience Improvements
- **Workflow Creation Speed**: 80% faster than JSON/API approach
  - Manual JSON: ~30 minutes for 5-node workflow
  - Visual builder: ~6 minutes for same workflow
- **Error Rate**: 90% reduction in invalid workflows
  - Real-time validation catches errors immediately
  - Visual feedback prevents edge misconfiguration
- **Learning Curve**: New users productive in <15 minutes
  - Drag-and-drop is intuitive
  - Templates provide starting points

### Technical Metrics
- **Test Coverage**: Target 85% for validation logic
- **Bundle Size**: <500KB additional (React Flow ~200KB, Zustand ~3KB, Dagre ~50KB)
- **Performance**: <100ms render time for 20-node workflows
- **SSE Latency**: <200ms event-to-UI update
- **Mobile Support**: Functional on viewport ≥375px

### Implementation Timeline
- **Total Duration**: 26 development days
- **Phase 1-4**: Core builder (10 days) - Minimum viable workflow creation
- **Phase 5-6**: Execution visualization (5 days) - Real-time monitoring
- **Phase 7**: Agent management (3 days) - Advanced configuration
- **Phase 8-10**: Polish (8 days) - Responsive design, UX, testing

---

## Risks & Mitigation

### Technical Risks

**Risk 1: React Flow Learning Curve**
- **Impact**: Medium - Could slow Phase 2-3 (core canvas)
- **Probability**: Low - Documentation is excellent
- **Mitigation**:
  - Start with basic React Flow examples from docs
  - Build incrementally (nodes → edges → custom nodes → config)
  - Use official examples as reference
- **Fallback**: If React Flow proves problematic, consider react-diagrams (heavier but more control)

**Risk 2: SSE Connection Stability**
- **Impact**: High - Real-time visualization is core feature
- **Probability**: Medium - Network issues, browser quirks
- **Mitigation**:
  - Implement auto-reconnect logic with exponential backoff
  - Visual indicator of connection status
  - Fallback to polling if SSE fails after 3 reconnect attempts
- **Monitoring**: Track reconnection events in observability logs

**Risk 3: Complex Input Mapping UX**
- **Impact**: Medium - Users need to reference other node outputs
- **Probability**: Low - Can start simple
- **Mitigation**:
  - Phase 1: Simple textarea for JSON input
  - Phase 2: Node dropdown + path input
  - Future: Autocomplete with dot-notation path suggestions
- **User Feedback**: Iterate based on testing in Phase 10

**Risk 4: DAG Validation Performance**
- **Impact**: Low - Validation could slow save operation
- **Probability**: Low - Kahn's algorithm is O(V+E)
- **Mitigation**:
  - Validate only on save, not on every edit
  - For 100-node workflows: ~1ms validation time
  - Debounce validation if running on every change

**Risk 5: Mobile Touch Gesture Complexity**
- **Impact**: Medium - Mobile is a must-have
- **Probability**: Low - React Flow supports touch
- **Mitigation**:
  - React Flow has built-in touch support
  - Test early on actual devices (Phase 8)
  - Larger touch targets (48x48px minimum)
  - Collapsible panels for screen real estate

### Project Risks

**Risk 6: Scope Creep**
- **Impact**: High - Could extend timeline significantly
- **Probability**: Medium - Feature-rich plan
- **Mitigation**:
  - Strict adherence to MVP criteria in plan
  - "Nice to Have" section clearly defined
  - Quality gates at each phase (must pass before next)
  - User approval required for scope additions

**Risk 7: Backend API Gaps**
- **Impact**: Medium - Could block frontend development
- **Probability**: Low - Backend is 100% complete
- **Mitigation**:
  - Verify all required endpoints in Phase 1
  - List in plan (Section 10): Agents CRUD, MCP APIs
  - If gaps found: Create backend tasks immediately

---

## Implementation Strategy

### Phase Breakdown (Sequential Wave Pattern)

#### Phase 1: Foundation & Infrastructure (2 days)
**Goal**: Install dependencies, create core infrastructure

**Tasks**:
- Install: React Flow, Zustand, Dagre
- Create: `useWorkflowEvents` SSE hook
- Create: `workflowBuilderStore` Zustand store
- Create: `autoLayout` utility with Dagre
- Update: API client with workflow CRUD and SSE methods

**Acceptance Criteria**:
- ✅ Dependencies installed without conflicts
- ✅ SSE hook connects and receives events
- ✅ Zustand store manages nodes/edges/history
- ✅ Auto-layout utility positions nodes correctly

**Quality Gate**: Run `bun run typecheck`, verify no errors

---

#### Phase 2: Workflow Builder - Core Canvas (3 days)
**Goal**: Visual DAG editor with drag-and-drop

**Tasks**:
- Create: `WorkflowBuilder` page (routes: `/workflows/new`, `/workflows/:id/edit`)
- Create: `WorkflowCanvas` with React Flow
- Create: 5 custom node components (Agent, Condition, Parallel, Loop, HumanReview)
- Create: `NodePalette` sidebar with draggable nodes
- Implement: Auto-layout on load, manual repositioning

**Acceptance Criteria**:
- ✅ Can drag nodes from palette onto canvas
- ✅ Can connect nodes with edges
- ✅ Can manually reposition nodes (override auto-layout)
- ✅ Auto-layout applies hierarchical layout on initial load
- ✅ Zoom/pan controls functional

**Quality Gate**: Create 5-node workflow visually, verify nodes render correctly

---

#### Phase 3: Node Configuration (3 days)
**Goal**: Dynamic configuration forms with validation

**Tasks**:
- Create: `NodeConfigPanel` (dynamic form based on node type)
- Create: `InputMappingEditor` (node reference + path)
- Create: `ResourceLimitsEditor` (Docker memory/CPU/timeout)
- Create: 5 node-specific config forms (AgentNodeConfig, etc.)
- Implement: Zod validation with error display

**Acceptance Criteria**:
- ✅ Clicking node shows config panel
- ✅ Can edit node properties (name, timeout, inputs)
- ✅ Input mapping allows node references (fromNode + path)
- ✅ Resource limits configurable (memory, CPU, timeout)
- ✅ Validation errors display clearly
- ✅ Save button updates Zustand store

**Quality Gate**: Configure all 5 node types, verify validation catches invalid inputs

---

#### Phase 4: Workflow Save & Validation (2 days)
**Goal**: Persist workflows with validation

**Tasks**:
- Create: `workflowValidation.ts` (cycles, entry nodes, edge targets)
- Create: `WorkflowMetadataForm` (name, description, triggers)
- Update: `WorkflowBuilder` with save/publish buttons
- Implement: Validation error highlighting on canvas
- Implement: Toast notifications for save success/failure

**Acceptance Criteria**:
- ✅ Can save workflow draft
- ✅ Validation catches cycles (A→B→C→A)
- ✅ Validation catches missing edge targets
- ✅ Validation requires at least one entry node
- ✅ Publish enables triggers (schedule, webhook, API)
- ✅ Redirects to workflow detail page on success

**Quality Gate**: Create workflow with intentional cycle, verify validation blocks save

---

#### Phase 5: Real-Time Execution Visualization (3 days)
**Goal**: Watch workflows execute with live updates

**Tasks**:
- Create: `ExecutionOverlay` (read-only React Flow canvas)
- Integrate: `useWorkflowEvents` hook for SSE
- Implement: Node color coding (pending/running/completed/failed)
- Create: `NodeExecutionModal` (input/output/logs/errors)
- Implement: Progress indicators on running nodes

**Acceptance Criteria**:
- ✅ Can trigger workflow run from builder
- ✅ Execution overlay opens automatically
- ✅ Nodes update colors in real-time via SSE
- ✅ Can click completed node to see output
- ✅ Can see error details for failed nodes
- ✅ Shows execution duration per node

**Quality Gate**: Trigger run, verify all nodes update in real-time without refresh

---

#### Phase 6: Docker Execution Monitoring (2 days)
**Goal**: Visualize container resource usage

**Tasks**:
- Create: `ContainerStatus` component (isolation, limits, usage)
- Create: `LogStreamViewer` (real-time log streaming)
- Update: `RunDetailPage` with cost tracking (tokens, cost per node)
- Implement: Log filtering by node ID
- Implement: Auto-scroll to bottom for logs

**Acceptance Criteria**:
- ✅ Can see container isolation strategy (container/process/shared)
- ✅ Can see resource limits (memory, CPU, timeout)
- ✅ Can see peak memory usage
- ✅ Can stream logs in real-time via SSE
- ✅ Can view cost breakdown per run
- ✅ Token usage and estimated cost displayed

**Quality Gate**: Run workflow with coding task, verify logs stream and resources shown

---

#### Phase 7: Agent & MCP Management (3 days)
**Goal**: UI for agent configuration and MCP tools

**Tasks**:
- Create: `AgentsPage` (list, create, edit, delete)
- Create: `AgentForm` (model, integration, prompt, skills, MCP tools)
- Create: `McpToolsPage` (list servers, status, config)
- Create: `IntegrationConfig` (credential management with vault)
- Update: Routes in `main.tsx`

**Acceptance Criteria**:
- ✅ Can list all agents
- ✅ Can create new agent with model selection
- ✅ Can configure integration (Claude Code, Codex, etc.)
- ✅ Can select MCP tools for agent
- ✅ Can list MCP servers with connection status
- ✅ Can test MCP connection

**Quality Gate**: Create agent, configure with MCP tools, verify saves correctly

---

#### Phase 8: Responsive Design & Mobile Support (3 days)
**Goal**: Functional on mobile and tablets

**Tasks**:
- Update: `WorkflowCanvas` with touch gesture support
- Update: Collapsible sidebars on mobile
- Update: Bottom sheet for node config on mobile
- Update: `Layout` with hamburger menu
- Update: All forms with larger touch targets (48x48px)

**Acceptance Criteria**:
- ✅ UI works on viewport 375px width (iPhone SE)
- ✅ Touch gestures pan/zoom canvas
- ✅ Sidebars collapse to save screen space
- ✅ Node config opens in bottom sheet on mobile
- ✅ Forms usable with touch (no tiny inputs)
- ✅ Navigation accessible via hamburger menu

**Quality Gate**: Test on actual mobile device (or Chrome DevTools mobile view)

---

#### Phase 9: UX Enhancements (2 days)
**Goal**: Polish and keyboard shortcuts

**Tasks**:
- Create: `useKeyboardShortcuts` hook (Ctrl+S, Delete, Ctrl+Z, Esc, Ctrl+D)
- Create: `WorkflowTemplates` page with pre-built examples
- Update: `Layout` with breadcrumbs and "Create Workflow" button
- Implement: Skeleton loaders for async content
- Implement: Error boundaries around React Flow
- Implement: Toast notifications for all user actions

**Acceptance Criteria**:
- ✅ Ctrl+S saves workflow
- ✅ Delete key removes selected node
- ✅ Ctrl+Z/Ctrl+Shift+Z undo/redo
- ✅ Esc deselects node
- ✅ Ctrl+D duplicates node
- ✅ Workflow templates loadable (5 examples)
- ✅ Loading states smooth (skeleton loaders)
- ✅ Error boundaries catch React Flow errors

**Quality Gate**: Use only keyboard to create workflow, verify all shortcuts work

---

#### Phase 10: Testing & Polish (3 days)
**Goal**: Comprehensive validation

**Manual Test Scenarios**:
1. Create workflow with all 5 node types
2. Configure each node (agent selection, inputs, timeouts)
3. Connect nodes with edges
4. Attempt to create cycle (should fail validation)
5. Save workflow
6. Trigger run
7. Watch real-time execution
8. Click nodes to inspect input/output
9. View Docker container logs
10. Verify cost tracking

**Validation Testing**:
- Empty workflow save (should fail)
- Cycle creation (should fail)
- Dangling edge to non-existent node (should fail)
- Condition node without branches (should fail)
- Parallel node with no branches (should fail)

**Performance Testing**:
- 20+ node workflow (render time <100ms)
- 100+ workflow runs (list pagination)
- SSE reconnection after network drop
- Memory usage during long runs (<100MB)

**Browser Compatibility**:
- Chrome (latest)
- Firefox (latest)
- Safari (latest)

**Acceptance Criteria**:
- ✅ All 10 manual scenarios pass
- ✅ All validation tests catch errors correctly
- ✅ Performance acceptable with large workflows
- ✅ SSE reconnects gracefully
- ✅ Works in all 3 browsers

**Quality Gate**: Zero critical bugs, all acceptance criteria met

---

## Success Criteria (Must-Have for MVP)

### Functional Requirements
- ✅ Visual workflow builder with drag-and-drop
- ✅ Support all 5 node types (Agent, Condition, Parallel, Loop, HumanReview)
- ✅ Node configuration forms with validation
- ✅ Save/load workflows
- ✅ Real-time execution visualization via SSE
- ✅ Basic error handling and user feedback
- ✅ Auto-layout with Dagre (manual override supported)
- ✅ Undo/redo functionality (Ctrl+Z/Ctrl+Shift+Z)
- ✅ Agent/MCP management UI
- ✅ Mobile/tablet responsive design
- ✅ Docker resource controls per node

### Technical Requirements
- ✅ TypeScript strict mode (no any types)
- ✅ Zod validation throughout
- ✅ React Query for server state
- ✅ Zustand for builder state
- ✅ TailwindCSS v4 styling
- ✅ SSE with auto-reconnect
- ✅ Error boundaries for fault tolerance

### Quality Requirements
- ✅ No console errors in production
- ✅ Loading states for all async operations
- ✅ Error messages user-friendly
- ✅ Responsive on viewport ≥375px
- ✅ Keyboard navigation functional

---

## Out of Scope (Nice to Have - Future)

❌ Workflow versioning UI
❌ Collaborative editing (WebSocket multi-user)
❌ Node search/filter in palette
❌ Canvas minimap
❌ Export workflow as JSON
❌ Import workflow from JSON
❌ User authentication and ownership
❌ Workflow analytics dashboard
❌ AI-assisted workflow generation
❌ Workflow marketplace/sharing

---

## Dependencies & Assumptions

### Backend API (Already Complete)
Verified endpoints needed:
- `GET /api/workflows` - List workflows
- `GET /api/workflows/:id` - Get workflow
- `POST /api/workflows` - Create workflow
- `PUT /api/workflows/:id` - Update workflow
- `DELETE /api/workflows/:id` - Delete workflow
- `POST /api/workflows/:id/run` - Trigger run
- `GET /api/runs/:id` - Get run details
- `GET /api/runs/:id/events` - SSE endpoint (already implemented)
- `GET /api/agents` - List agents
- `POST /api/agents` - Create agent
- `PUT /api/agents/:id` - Update agent
- `DELETE /api/agents/:id` - Delete agent
- `GET /api/mcp/servers` - List MCP servers
- `GET /api/mcp/tools` - List MCP tools

### Assumptions
1. Backend APIs are stable and won't change during implementation
2. SSE endpoint is production-ready with proper error handling
3. PostgreSQL schema supports all workflow node types
4. Redis pub/sub is reliable for event streaming
5. Docker isolation is functional and tested
6. TailwindCSS v4 is already configured in frontend
7. Vite build pipeline supports React Flow without issues

---

## Next Steps

After plan approval:
1. **Phase 1 Start**: Install dependencies (React Flow, Zustand, Dagre)
2. **Foundation**: Create SSE hook and Zustand store
3. **Quality Gate**: Verify SSE connection and state management
4. **Phase 2 Start**: Build core canvas with React Flow
5. **Continuous Documentation**: Update `do.md` with implementation log

**Ready to proceed?** Waiting for user confirmation to start Phase 1.
