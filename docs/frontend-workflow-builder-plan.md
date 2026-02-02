# Comprehensive Frontend Enhancement Plan: Visual Workflow Builder

## 1. Project Context

### Current State
Pluribus currently has:
- **Backend**: Robust DAG-based workflow engine with 5 node types, Docker isolation, WebSocket/SSE support
- **Frontend**: Minimal MVP (3 pages) for viewing workflows, triggering runs, and monitoring execution
- **Gap**: No workflow creation, editing, or visualization capabilities in UI

### User Request
Build a comprehensive frontend where users can:
1. **Create workflows visually** via drag-and-drop workflow builder
2. **Visualize workflow DAGs** with nodes and edges
3. **Execute workflows** and monitor real-time progress
4. **Support coding tasks** in dockerized sandboxes (backend already supports this)

---

## 2. Architecture Overview

### Technology Stack
- **React 19** with TypeScript (existing)
- **React Flow** (new) - For DAG visualization and workflow builder
- **TanStack React Query** (existing) - Server state management
- **Zustand** (new) - Client state management for builder
- **TailwindCSS v4** (existing) - Styling
- **Zod** (existing) - Validation
- **SSE integration** (new) - Replace polling with real-time updates

### Key Components
1. **Workflow Builder Canvas** - Visual DAG editor with React Flow
2. **Node Configuration Panel** - Form-based node property editing
3. **Node Palette** - Draggable node types library
4. **Execution Visualizer** - Real-time workflow run visualization
5. **Docker Execution Monitor** - Sandbox status and logs

---

## 3. Implementation Plan

### Phase 1: Foundation & Infrastructure (Days 1-2)

#### 1.1 Install Dependencies
```bash
cd frontend
bun add @xyflow/react zustand @dagrejs/dagre
bun add -d @types/node
```

#### 1.2 Update API Client
**File**: `frontend/src/api/client.ts`
- Add workflow CRUD methods:
  - `api.workflows.create(workflow)`
  - `api.workflows.update(id, workflow)`
  - `api.workflows.delete(id)`
- Add SSE connection helper:
  - `api.workflowRuns.streamEvents(runId): EventSource`

#### 1.3 Create SSE Hook
**New File**: `frontend/src/hooks/useWorkflowEvents.ts`
```typescript
export function useWorkflowEvents(runId: string | undefined) {
  // Manages SSE connection to /api/runs/:id/events
  // Returns: { events, isConnected, latestEvent }
  // Auto-reconnect on disconnect
  // Cleanup on unmount
}
```

#### 1.4 Create Zustand Store for Builder State
**New File**: `frontend/src/stores/workflowBuilderStore.ts`
```typescript
interface WorkflowBuilderState {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedNode: string | null;
  history: { nodes: WorkflowNode[]; edges: WorkflowEdge[] }[];
  historyIndex: number;
  addNode: (node: WorkflowNode) => void;
  updateNode: (id: string, updates: Partial<WorkflowNode>) => void;
  deleteNode: (id: string) => void;
  addEdge: (edge: WorkflowEdge) => void;
  deleteEdge: (id: string) => void;
  setNodes: (nodes: WorkflowNode[]) => void;
  setEdges: (edges: WorkflowEdge[]) => void;
  undo: () => void;
  redo: () => void;
  reset: () => void;
}
```

---

### Phase 2: Workflow Builder - Core Canvas (Days 3-5)

#### 2.1 Create Base Workflow Builder Page
**New File**: `frontend/src/pages/WorkflowBuilder.tsx`
- Route: `/workflows/new` and `/workflows/:id/edit`
- Layout: Sidebar (node palette) + Canvas + Right panel (node config)
- State: Load existing workflow on edit, empty on new
- Navigation: Save button, Cancel button, Test Run button

#### 2.2 Implement React Flow Canvas
**New File**: `frontend/src/components/workflow/WorkflowCanvas.tsx`
```typescript
export function WorkflowCanvas() {
  // React Flow instance
  // Node/edge state from Zustand store
  // Drag-and-drop support
  // Auto-layout with Dagre (on load, manual override after)
  // Zoom controls
  // Background grid
  // Responsive sizing for mobile/tablet
}
```

#### 2.2.1 Create Auto-Layout Utility
**New File**: `frontend/src/lib/autoLayout.ts`
```typescript
export function applyDagreLayout(nodes: Node[], edges: Edge[]): Node[] {
  // Use @dagrejs/dagre to calculate node positions
  // Hierarchical top-to-bottom layout
  // Return nodes with x/y positions
}
```

#### 2.3 Create Custom Node Components
**New Files**: `frontend/src/components/workflow/nodes/`
- `AgentNode.tsx` - Agent execution node
- `ConditionNode.tsx` - Branching node with true/false handles
- `ParallelNode.tsx` - Multiple output handles
- `LoopNode.tsx` - Circular iteration indicator
- `HumanReviewNode.tsx` - Pause/approval node

Each node displays:
- Node type icon
- Node label/ID
- Input/output handles (React Flow)
- Status indicator (during execution)
- Configuration summary

#### 2.4 Create Node Palette Sidebar
**New File**: `frontend/src/components/workflow/NodePalette.tsx`
```typescript
export function NodePalette() {
  // Draggable node type buttons
  // Node type categories
  // Description tooltips
  // Search/filter
}
```
Node types:
- Agent Node (robot icon)
- Condition Node (diamond icon)
- Parallel Node (fork icon)
- Loop Node (circular arrow icon)
- Human Review Node (hand icon)

---

### Phase 3: Node Configuration (Days 6-8)

#### 3.1 Create Node Configuration Panel
**New File**: `frontend/src/components/workflow/NodeConfigPanel.tsx`
```typescript
export function NodeConfigPanel({ nodeId }: { nodeId: string }) {
  // Dynamic form based on node type
  // Zod validation with error display
  // Agent dropdown (for AgentNode)
  // Input mapping editor (fromNode + path support)
  // Timeout configuration
  // Save/Cancel buttons
}
```

#### 3.2 Create Input Mapping Editor
**New File**: `frontend/src/components/workflow/InputMappingEditor.tsx`
```typescript
export function InputMappingEditor({ value, onChange }) {
  // Add/remove key-value pairs
  // Toggle between literal and node reference
  // Node dropdown + path input for references
  // Dot-notation path autocomplete (if time permits)
}
```

#### 3.3 Implement Node-Specific Forms
**New Files**: `frontend/src/components/workflow/config/`
- `AgentNodeConfig.tsx` - Agent selection, input mapping, timeout, **resource limits**
- `ConditionNodeConfig.tsx` - Expression editor, branch targets
- `ParallelNodeConfig.tsx` - Branch selection, join strategy dropdown
- `LoopNodeConfig.tsx` - Condition expression, max iterations, body target
- `HumanReviewNodeConfig.tsx` - Prompt text, options list, timeout

#### 3.4 Add Resource Limits Configuration
**New File**: `frontend/src/components/workflow/ResourceLimitsEditor.tsx`
```typescript
export function ResourceLimitsEditor({ value, onChange }) {
  // Memory limit slider/input (MB)
  // CPU percent slider/input (0-100%)
  // Timeout input (seconds/minutes)
  // Isolation strategy dropdown (container/process/shared)
  // Presets: "Light", "Medium", "Heavy"
}
```

---

### Phase 4: Workflow Save & Validation (Days 9-10)

#### 4.1 Implement Workflow Validation
**New File**: `frontend/src/lib/workflowValidation.ts`
```typescript
export function validateWorkflow(nodes: WorkflowNode[], edges: WorkflowEdge[]) {
  // Check for entry nodes
  // Validate all edge targets exist
  // Check for cycles (Kahn's algorithm)
  // Validate node-specific constraints
  // Return validation errors array
}
```

#### 4.2 Create Save/Publish Flow
**Update**: `frontend/src/pages/WorkflowBuilder.tsx`
- "Save Draft" button (saves without triggers)
- "Publish" button (validates + enables triggers)
- Validation error display (highlight problematic nodes)
- Success/error toast notifications
- Redirect to workflow detail page on success

#### 4.3 Add Workflow Metadata Form
**New File**: `frontend/src/components/workflow/WorkflowMetadataForm.tsx`
```typescript
export function WorkflowMetadataForm({ workflow, onUpdate }) {
  // Workflow name (required)
  // Description (optional)
  // Trigger configuration:
  //   - Manual (always enabled)
  //   - Schedule (cron expression)
  //   - Webhook (auto-generated URL)
  //   - API (enabled/disabled toggle)
  // Error strategy dropdown
}
```

---

### Phase 5: Real-Time Execution Visualization (Days 11-13)

#### 5.1 Create Execution Overlay
**New File**: `frontend/src/components/workflow/ExecutionOverlay.tsx`
```typescript
export function ExecutionOverlay({ runId }: { runId: string }) {
  // Read-only React Flow canvas
  // Load workflow definition + run data
  // Color-code nodes by status (pending, running, completed, failed)
  // Show progress indicators on running nodes
  // Display node execution times
  // Click node to see input/output
}
```

#### 5.2 Integrate SSE for Live Updates
**Update**: `frontend/src/components/workflow/ExecutionOverlay.tsx`
- Use `useWorkflowEvents(runId)` hook
- Update node colors on `node:started`, `node:completed`, `node:failed`
- Show real-time logs in side panel
- Display workflow completion time

#### 5.3 Add Execution Detail Modal
**New File**: `frontend/src/components/workflow/NodeExecutionModal.tsx`
```typescript
export function NodeExecutionModal({ nodeRunId }: { nodeRunId: string }) {
  // Fetch node execution data
  // Display:
  //   - Node type and ID
  //   - Status badge
  //   - Input JSON viewer
  //   - Output JSON viewer
  //   - Error details (if failed)
  //   - Execution timestamps
  //   - Resource usage (if available)
}
```

---

### Phase 6: Docker Execution Monitoring (Days 14-15)

#### 6.1 Add Container Status Display
**New File**: `frontend/src/components/workflow/ContainerStatus.tsx`
```typescript
export function ContainerStatus({ nodeRunId }: { nodeRunId: string }) {
  // Show isolation strategy used (container/process/shared)
  // Container resource limits (memory, CPU, duration)
  // Peak memory usage
  // Wall time vs CPU time
  // Docker image used
}
```

#### 6.2 Create Log Stream Viewer
**New File**: `frontend/src/components/workflow/LogStreamViewer.tsx`
```typescript
export function LogStreamViewer({ runId }: { runId: string }) {
  // Subscribe to SSE events
  // Display tool-call events for coding tasks
  // Show thinking/reasoning logs
  // Filter by node ID
  // Auto-scroll to bottom
  // Copy to clipboard button
}
```

#### 6.3 Add Cost Tracking Dashboard
**Update**: `frontend/src/pages/RunDetailPage.tsx`
- Display total token usage (input + output)
- Estimated cost per run
- Breakdown by node
- Model used per agent node
- Cost trend visualization (if time permits)

---

### Phase 7: Agent & MCP Management (Days 16-18)

**Status**: ✅ Agent Management Complete (2026-02-02) | MCP Management Pending

#### 7.0.1 Create Agents Management Page ✅ COMPLETE
**File**: `frontend/src/pages/AgentsPage.tsx`
- [x] Route: `/agents`
- [x] List all agents with search/filter (by name, description, tags)
- [x] Create agent button → navigates to `/agents/new`
- [x] Edit/delete actions (delete with confirmation)
- [x] Table columns: Name, Model, Integration, Tags, Created Date
- [x] 13 tests passing

#### 7.0.2 Create Agent Form ✅ COMPLETE
**File**: `frontend/src/components/agents/AgentForm.tsx`
- [x] Agent name input (required, validated)
- [x] Description textarea
- [x] Provider dropdown (Anthropic, OpenAI, Custom)
- [x] Model input
- [x] Tags input (comma-separated)
- [x] Memory mode selection (stateless, session, persistent)
- [x] Isolation level selection (shared, process, container)
- [x] Sub-agent configuration (checkbox + max count)
- [x] Create mode (`/agents/new`) and edit mode (`/agents/:id/edit`)
- [x] Form validation with error display
- [x] 16 tests passing

#### 7.0.3 Add MCP Tools Management Page
**New File**: `frontend/src/pages/McpToolsPage.tsx`
- [ ] Route: `/mcp-tools`
- [ ] List all MCP servers/tools
- [ ] Tool status indicators (connected/disconnected)
- [ ] Configuration modal for each server
- [ ] Test connection button

#### 7.0.4 Create Integration Configuration UI
**New File**: `frontend/src/components/integrations/IntegrationConfig.tsx`
- [ ] Dynamic form based on integration type
- [ ] Credential input (with vault encryption)
- [ ] Test connection button
- [ ] Save/cancel

---

### Phase 8: Responsive Design & Mobile Support (Days 19-21)

#### 8.0.1 Make Canvas Mobile-Friendly
**Update**: `frontend/src/components/workflow/WorkflowCanvas.tsx`
- Touch gesture support for pan/zoom (React Flow has built-in support)
- Responsive sidebar (collapsible on mobile)
- Bottom sheet for node config on mobile
- Larger touch targets for nodes/edges

#### 8.0.2 Responsive Layout Updates
**Update**: `frontend/src/components/Layout.tsx`
- Hamburger menu for navigation on mobile
- Responsive header with collapsible links
- Bottom navigation bar on mobile (optional)

#### 8.0.3 Mobile-Optimized Forms
**Update**: All config forms
- Stack form inputs vertically on mobile
- Larger input fields for touch
- Mobile-friendly dropdowns
- Swipe gestures for multi-step forms

---

### Phase 9: UX Enhancements (Days 22-23)

#### 9.1 Improve Navigation
**Update**: `frontend/src/components/Layout.tsx`
- Add "Create Workflow" button in header
- Breadcrumb navigation
- Active route highlighting

#### 9.2 Add Workflow Templates
**New File**: `frontend/src/pages/WorkflowTemplates.tsx`
- Pre-built workflow examples:
  - "Simple Agent Task"
  - "Sequential Pipeline"
  - "Parallel Execution"
  - "Human-in-the-Loop"
  - "Conditional Branching"
- "Use Template" button to load in builder

#### 9.3 Implement Keyboard Shortcuts
**New File**: `frontend/src/hooks/useKeyboardShortcuts.ts`
```typescript
// Ctrl+S: Save workflow
// Delete: Delete selected node
// Ctrl+Z: Undo
// Ctrl+Shift+Z: Redo
// Esc: Deselect node
// Ctrl+D: Duplicate selected node
```

#### 9.4 Add Loading States & Error Boundaries
- Skeleton loaders for all async content
- Error boundary wrapper around React Flow
- Retry buttons on API failures
- Toast notifications for user actions

---

### Phase 10: Testing & Polish (Days 24-26)

#### 10.1 End-to-End Testing
**Manual Test Scenarios**:
1. Create new workflow with all node types
2. Configure agent node with input mapping
3. Add edges between nodes
4. Validate DAG (test cycle detection)
5. Save workflow
6. Trigger workflow run
7. Watch real-time execution via SSE
8. View node execution details
9. Check Docker container logs
10. Verify cost tracking

#### 10.2 Validation Testing
- Test empty workflow save (should fail)
- Test cycle creation (should fail validation)
- Test dangling edge (edge to non-existent node)
- Test condition node without branches
- Test parallel node with no branches

#### 10.3 Performance Testing
- Test with 20+ node workflow
- Test with 100+ workflow runs
- Check SSE reconnection on network drop
- Verify memory usage during long runs

#### 10.4 Browser Compatibility
- Test in Chrome, Firefox, Safari
- Verify React Flow touch support (if mobile needed)

---

## 4. Critical Files to Create/Modify

### New Files (Core)
- `frontend/src/pages/WorkflowBuilder.tsx` - Main builder page
- `frontend/src/components/workflow/WorkflowCanvas.tsx` - React Flow canvas
- `frontend/src/components/workflow/NodePalette.tsx` - Node type sidebar
- `frontend/src/components/workflow/NodeConfigPanel.tsx` - Configuration form
- `frontend/src/components/workflow/ExecutionOverlay.tsx` - Real-time visualization
- `frontend/src/stores/workflowBuilderStore.ts` - Zustand state
- `frontend/src/hooks/useWorkflowEvents.ts` - SSE hook

### New Files (Supporting)
- `frontend/src/components/workflow/nodes/*.tsx` - 5 custom node components
- `frontend/src/components/workflow/config/*.tsx` - 5 node config forms
- `frontend/src/components/workflow/InputMappingEditor.tsx`
- `frontend/src/components/workflow/WorkflowMetadataForm.tsx`
- `frontend/src/components/workflow/ContainerStatus.tsx`
- `frontend/src/components/workflow/LogStreamViewer.tsx`
- `frontend/src/components/workflow/ResourceLimitsEditor.tsx`
- `frontend/src/lib/workflowValidation.ts`
- `frontend/src/lib/autoLayout.ts`
- `frontend/src/hooks/useKeyboardShortcuts.ts`

### New Files (Agent/MCP Management)
- `frontend/src/pages/AgentsPage.tsx` - Agent management
- `frontend/src/pages/McpToolsPage.tsx` - MCP tools page
- `frontend/src/components/agents/AgentForm.tsx` - Agent create/edit form
- `frontend/src/components/integrations/IntegrationConfig.tsx` - Integration setup

### Modified Files
- `frontend/src/api/client.ts` - Add CRUD and SSE methods
- `frontend/src/components/Layout.tsx` - Add navigation
- `frontend/src/pages/RunDetailPage.tsx` - Add cost tracking
- `frontend/vite.config.ts` - Possibly adjust for SSE proxy
- `frontend/src/main.tsx` - Add new routes

---

## 5. Verification Plan

### Manual Verification Steps

#### Step 1: Workflow Creation
```bash
make dev-frontend  # Start frontend
# Navigate to http://localhost:5173/workflows/new
# Drag 3 agent nodes onto canvas
# Connect them sequentially
# Configure each node (select agent, set timeout)
# Save workflow
# Verify workflow appears in workflows list
```

#### Step 2: Workflow Execution
```bash
# From workflows list, click "Run" button
# Navigate to execution visualization page
# Watch nodes turn from pending → running → completed
# Verify SSE updates in browser DevTools Network tab
# Check node output by clicking on completed nodes
```

#### Step 3: Docker Sandbox Verification
```bash
# Create workflow with agent node using coding task
# Configure agent to use container isolation
# Trigger run
# Watch container logs in LogStreamViewer
# Verify container status shows resource limits
# Check container cleanup after completion:
docker ps -a | grep pluribus
# Should be empty or only show stopped containers
```

#### Step 4: Real-Time Updates
```bash
# Open browser DevTools → Network → EventStream
# Trigger workflow run
# Verify SSE connection to /api/runs/:id/events
# Check event types received: node:started, node:completed, etc.
# Verify UI updates without polling
```

#### Step 5: Validation Testing
```bash
# Create workflow with cycle (A → B → C → A)
# Attempt to save
# Verify validation error message appears
# Remove cycle edge
# Verify save succeeds
```

### Automated Test Suggestions (Future)
- React Testing Library tests for node components
- Cypress E2E tests for builder flow
- Jest tests for validation logic
- MSW mocks for API client tests

---

## 6. Success Criteria

### Must Have (MVP)
- ✅ Visual workflow builder with drag-and-drop
- ✅ Support all 5 node types (Agent, Condition, Parallel, Loop, Human Review)
- ✅ Node configuration forms with validation
- ✅ Save/load workflows
- ✅ Real-time execution visualization
- ✅ SSE integration for live updates
- ✅ Basic error handling
- ✅ Auto-layout with Dagre (manual override)
- ✅ Undo/Redo functionality
- ✅ Agent/MCP management UI
- ✅ Mobile/tablet responsive design
- ✅ Docker resource controls per node

### Should Have
- ✅ Docker container status monitoring
- ✅ Log streaming for coding tasks
- ✅ Cost tracking display
- ✅ Workflow templates
- ✅ Keyboard shortcuts (including Ctrl+Z/Ctrl+Shift+Z)
- ✅ DAG validation (cycle detection)
- ✅ Touch gesture support for mobile

### Included in MVP (Per User Confirmation)
- ✅ Auto-layout with Dagre (manual override supported)
- ✅ Undo/redo functionality (Ctrl+Z/Ctrl+Shift+Z)
- ✅ Agent/MCP management UI (create, configure, bind integrations)
- ✅ Mobile/tablet responsive design
- ✅ Docker resource controls (memory, CPU, timeout per node)

### Nice to Have (Future)
- Workflow versioning UI
- Collaborative editing (WebSocket)
- Node search/filter in palette
- Canvas minimap
- Export workflow as JSON
- Import workflow from JSON
- User authentication and ownership

---

## 7. Risks & Mitigations

### Risk 1: React Flow Learning Curve
**Mitigation**: Start with basic examples from docs, build incrementally

### Risk 2: SSE Connection Stability
**Mitigation**: Implement auto-reconnect logic, fallback to polling if SSE fails

### Risk 3: Complex Input Mapping UX
**Mitigation**: Start with simple textarea, iterate based on user feedback

### Risk 4: DAG Validation Performance
**Mitigation**: Validate on save only, not on every edit

### Risk 5: Docker Container Logs Volume
**Mitigation**: Implement log pagination, limit to last 1000 lines

---

## 8. User Decisions (Confirmed)

1. **Workflow Permissions**: Open access (no authentication) for MVP
2. **Auto-Layout**: Auto-layout with Dagre + manual override
3. **Undo/Redo**: Must-have for MVP
4. **Workflow Import/Export**: Future feature (not MVP)
5. **Mobile Support**: Responsive design required
6. **Agent Management**: Agent/MCP UI included in scope
7. **MCP Tool Selection**: Users configure in Agent form
8. **Execution Limits**: UI controls for resource limits included

---

## 9. Timeline Estimate

**Total Estimated Duration**: 26 development days (5-6 weeks with testing/refinement)

**Phases**:
- Phase 1: Foundation (2 days)
- Phase 2: Core Canvas (3 days)
- Phase 3: Node Configuration (3 days)
- Phase 4: Save/Validation (2 days)
- Phase 5: Execution Visualization (3 days)
- Phase 6: Docker Monitoring (2 days)
- Phase 7: Agent/MCP Management (3 days)
- Phase 8: Responsive Design (3 days)
- Phase 9: UX Enhancements (2 days)
- Phase 10: Testing & Polish (3 days)

**Note**: Timeline assumes full-time development. Adjust based on actual availability.

---

## 10. Technical Dependencies

### Backend API Extensions Needed
Most APIs already exist, but we need to ensure these are fully implemented:
- `POST /api/agents` - Create agent
- `PUT /api/agents/:id` - Update agent
- `DELETE /api/agents/:id` - Delete agent
- `GET /api/mcp/servers` - List MCP servers
- `GET /api/mcp/tools` - List available tools
- `POST /api/mcp/servers` - Register MCP server
- `DELETE /api/mcp/servers/:id` - Remove MCP server

### Frontend Type Definitions
Need to mirror backend schemas for type safety:
- `WorkflowNode` discriminated union (5 types)
- `WorkflowEdge` interface
- `Agent` interface
- `McpServer` and `McpTool` interfaces
- `ResourceLimits` interface

---

## 11. Next Steps

After plan approval:
1. Set up development environment (`make dev-frontend`)
2. Install React Flow and Zustand dependencies
3. Create basic workflow builder route and canvas
4. Iterate through phases sequentially
5. Request feedback after each major phase completion
