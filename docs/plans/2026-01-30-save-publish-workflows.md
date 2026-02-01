# Save/Publish Workflows Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable users to save workflow canvas state to the backend API and load existing workflows for editing.

**Architecture:** Transform React Flow nodes/edges to backend-compatible format, add client-side validation before save, implement save/update mutations with React Query, and load workflows with proper data transformation. Use Zustand store for dirty state tracking.

**Tech Stack:** React Query mutations, Zod validation, Zustand store extensions, existing api client

---

## Task 1: Workflow Serialization Utils

**Files:**
- Create: `frontend/src/lib/workflow/serialization.ts`
- Test: `frontend/src/lib/workflow/serialization.test.ts`

### Step 1: Write the failing test for toBackendFormat

```typescript
// frontend/src/lib/workflow/serialization.test.ts
import { describe, it, expect } from 'vitest';
import { toBackendFormat, fromBackendFormat } from './serialization';
import type { WorkflowNode, WorkflowEdge } from '@/stores/workflowBuilderStore';

describe('serialization', () => {
  describe('toBackendFormat', () => {
    it('converts React Flow nodes to backend format', () => {
      const nodes: WorkflowNode[] = [
        {
          id: 'node-1',
          type: 'agent',
          position: { x: 100, y: 200 },
          data: {
            label: 'Test Agent',
            agentId: '123e4567-e89b-12d3-a456-426614174000',
            input: { prompt: 'Hello' },
            timeout: 30,
          },
        },
      ];

      const result = toBackendFormat(nodes, []);

      expect(result.nodes).toHaveLength(1);
      expect(result.nodes[0]).toEqual({
        id: 'node-1',
        type: 'agent',
        agentId: '123e4567-e89b-12d3-a456-426614174000',
        input: { prompt: 'Hello' },
        timeout: 30,
      });
    });

    it('converts React Flow edges to backend format', () => {
      const edges: WorkflowEdge[] = [
        { id: 'edge-1', source: 'node-1', target: 'node-2' },
      ];

      const result = toBackendFormat([], edges);

      expect(result.edges).toHaveLength(1);
      expect(result.edges[0]).toEqual({
        id: 'edge-1',
        from: 'node-1',
        to: 'node-2',
      });
    });
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd frontend && bun test src/lib/workflow/serialization.test.ts`
Expected: FAIL - module not found

### Step 3: Write minimal implementation

```typescript
// frontend/src/lib/workflow/serialization.ts
import type { WorkflowNode, WorkflowEdge } from '@/stores/workflowBuilderStore';

interface BackendNode {
  id: string;
  type: string;
  agentId?: string;
  input?: Record<string, unknown>;
  timeout?: number;
  expression?: string;
  trueBranch?: string;
  falseBranch?: string;
  branches?: string[];
  joinStrategy?: 'all' | 'any' | 'race';
  condition?: string;
  maxIterations?: number;
  body?: string;
  prompt?: string;
  options?: string[];
}

interface BackendEdge {
  id: string;
  from: string;
  to: string;
  label?: string;
}

export interface BackendWorkflowDefinition {
  nodes: BackendNode[];
  edges: BackendEdge[];
}

export function toBackendFormat(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): BackendWorkflowDefinition {
  const backendNodes: BackendNode[] = nodes.map((node) => {
    const base = { id: node.id, type: node.type };
    const { label, config, ...configData } = node.data;

    switch (node.type) {
      case 'agent':
        return {
          ...base,
          agentId: configData.agentId,
          input: configData.input ?? {},
          timeout: configData.timeout,
        };
      case 'condition':
        return {
          ...base,
          expression: configData.expression,
          trueBranch: configData.trueBranch,
          falseBranch: configData.falseBranch,
        };
      case 'parallel':
        return {
          ...base,
          branches: configData.branches ?? [],
          joinStrategy: configData.joinStrategy ?? 'all',
        };
      case 'loop':
        return {
          ...base,
          condition: configData.condition,
          maxIterations: configData.maxIterations,
          body: configData.body,
        };
      case 'human-review':
        return {
          ...base,
          prompt: configData.prompt,
          timeout: configData.timeout,
          options: configData.options,
        };
      default:
        return base;
    }
  });

  const backendEdges: BackendEdge[] = edges.map((edge) => ({
    id: edge.id,
    from: edge.source,
    to: edge.target,
    label: edge.label,
  }));

  return { nodes: backendNodes, edges: backendEdges };
}

export function fromBackendFormat(
  definition: BackendWorkflowDefinition,
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  // Will implement in next step
  return { nodes: [], edges: [] };
}
```

### Step 4: Run test to verify it passes

Run: `cd frontend && bun test src/lib/workflow/serialization.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add frontend/src/lib/workflow/serialization.ts frontend/src/lib/workflow/serialization.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): add workflow serialization toBackendFormat

Converts React Flow nodes/edges to backend API format for saving.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Workflow Deserialization (fromBackendFormat)

**Files:**
- Modify: `frontend/src/lib/workflow/serialization.ts`
- Modify: `frontend/src/lib/workflow/serialization.test.ts`

### Step 1: Write the failing test

```typescript
// Add to serialization.test.ts

describe('fromBackendFormat', () => {
  it('converts backend nodes to React Flow format', () => {
    const definition: BackendWorkflowDefinition = {
      nodes: [
        {
          id: 'node-1',
          type: 'agent',
          agentId: '123e4567-e89b-12d3-a456-426614174000',
          input: { prompt: 'Hello' },
          timeout: 30,
        },
      ],
      edges: [],
    };

    const result = fromBackendFormat(definition);

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].id).toBe('node-1');
    expect(result.nodes[0].type).toBe('agent');
    expect(result.nodes[0].data.agentId).toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(result.nodes[0].position).toBeDefined();
  });

  it('converts backend edges to React Flow format', () => {
    const definition: BackendWorkflowDefinition = {
      nodes: [],
      edges: [{ id: 'edge-1', from: 'node-1', to: 'node-2' }],
    };

    const result = fromBackendFormat(definition);

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0]).toEqual({
      id: 'edge-1',
      source: 'node-1',
      target: 'node-2',
    });
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd frontend && bun test src/lib/workflow/serialization.test.ts`
Expected: FAIL - nodes array is empty

### Step 3: Update implementation

```typescript
// Update fromBackendFormat in serialization.ts

export function fromBackendFormat(
  definition: BackendWorkflowDefinition,
): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const nodes: WorkflowNode[] = definition.nodes.map((node, index) => {
    // Generate position in a grid layout (will be re-laid out by Dagre)
    const position = { x: (index % 3) * 200, y: Math.floor(index / 3) * 150 };

    const baseData: Record<string, unknown> = {};

    switch (node.type) {
      case 'agent':
        Object.assign(baseData, {
          agentId: node.agentId,
          input: node.input,
          timeout: node.timeout,
        });
        break;
      case 'condition':
        Object.assign(baseData, {
          expression: node.expression,
          trueBranch: node.trueBranch,
          falseBranch: node.falseBranch,
        });
        break;
      case 'parallel':
        Object.assign(baseData, {
          branches: node.branches,
          joinStrategy: node.joinStrategy,
        });
        break;
      case 'loop':
        Object.assign(baseData, {
          condition: node.condition,
          maxIterations: node.maxIterations,
          body: node.body,
        });
        break;
      case 'human-review':
        Object.assign(baseData, {
          prompt: node.prompt,
          timeout: node.timeout,
          options: node.options,
        });
        break;
    }

    return {
      id: node.id,
      type: node.type,
      position,
      data: baseData,
    };
  });

  const edges: WorkflowEdge[] = definition.edges.map((edge) => ({
    id: edge.id,
    source: edge.from,
    target: edge.to,
  }));

  return { nodes, edges };
}
```

### Step 4: Run test to verify it passes

Run: `cd frontend && bun test src/lib/workflow/serialization.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add frontend/src/lib/workflow/serialization.ts frontend/src/lib/workflow/serialization.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): add fromBackendFormat for loading workflows

Converts backend workflow definitions to React Flow format.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Workflow Validation Before Save

**Files:**
- Create: `frontend/src/lib/workflow/validation.ts`
- Test: `frontend/src/lib/workflow/validation.test.ts`

### Step 1: Write the failing test

```typescript
// frontend/src/lib/workflow/validation.test.ts
import { describe, it, expect } from 'vitest';
import { validateWorkflow, type WorkflowValidationResult } from './validation';
import type { WorkflowNode, WorkflowEdge } from '@/stores/workflowBuilderStore';

describe('validateWorkflow', () => {
  it('returns valid for empty workflow', () => {
    const result = validateWorkflow([], []);
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('detects missing required agent fields', () => {
    const nodes: WorkflowNode[] = [
      {
        id: 'node-1',
        type: 'agent',
        position: { x: 0, y: 0 },
        data: { label: 'Test' }, // missing agentId
      },
    ];

    const result = validateWorkflow(nodes, []);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        nodeId: 'node-1',
        message: expect.stringContaining('agentId'),
      }),
    );
  });

  it('detects cycles in workflow graph', () => {
    const nodes: WorkflowNode[] = [
      { id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: { agentId: '123e4567-e89b-12d3-a456-426614174000' } },
      { id: 'node-2', type: 'agent', position: { x: 0, y: 100 }, data: { agentId: '123e4567-e89b-12d3-a456-426614174000' } },
    ];
    const edges: WorkflowEdge[] = [
      { id: 'edge-1', source: 'node-1', target: 'node-2' },
      { id: 'edge-2', source: 'node-2', target: 'node-1' }, // cycle!
    ];

    const result = validateWorkflow(nodes, edges);

    expect(result.isValid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining('cycle'),
      }),
    );
  });

  it('detects orphaned nodes', () => {
    const nodes: WorkflowNode[] = [
      { id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: { agentId: '123e4567-e89b-12d3-a456-426614174000' } },
      { id: 'node-2', type: 'agent', position: { x: 0, y: 100 }, data: { agentId: '123e4567-e89b-12d3-a456-426614174000' } },
      { id: 'node-3', type: 'agent', position: { x: 0, y: 200 }, data: { agentId: '123e4567-e89b-12d3-a456-426614174000' } }, // orphan
    ];
    const edges: WorkflowEdge[] = [
      { id: 'edge-1', source: 'node-1', target: 'node-2' },
    ];

    const result = validateWorkflow(nodes, edges);

    expect(result.isValid).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        nodeId: 'node-3',
        message: expect.stringContaining('disconnected'),
      }),
    );
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd frontend && bun test src/lib/workflow/validation.test.ts`
Expected: FAIL - module not found

### Step 3: Write implementation

```typescript
// frontend/src/lib/workflow/validation.ts
import type { WorkflowNode, WorkflowEdge } from '@/stores/workflowBuilderStore';
import { validateNodeConfig, type WorkflowNodeType } from '@/lib/validation/nodeSchemas';

export interface ValidationIssue {
  nodeId?: string;
  edgeId?: string;
  message: string;
  field?: string;
}

export interface WorkflowValidationResult {
  isValid: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

/**
 * Validates workflow before saving
 * Checks:
 * 1. Node configuration completeness
 * 2. Graph structure (no cycles via Kahn's algorithm)
 * 3. Connectivity (warns about orphans)
 */
export function validateWorkflow(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): WorkflowValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Empty workflow is valid
  if (nodes.length === 0) {
    return { isValid: true, errors: [], warnings: [] };
  }

  // 1. Validate each node's configuration
  for (const node of nodes) {
    const result = validateNodeConfig(node.type as WorkflowNodeType, node.data);
    if (!result.success) {
      for (const err of result.errors) {
        errors.push({
          nodeId: node.id,
          message: `${err.path.join('.')}: ${err.message}`,
          field: err.path.join('.'),
        });
      }
    }
  }

  // 2. Check for cycles using Kahn's algorithm
  const cycleResult = detectCycles(nodes, edges);
  if (cycleResult.hasCycle) {
    errors.push({
      message: 'Workflow contains a cycle - DAG required',
    });
  }

  // 3. Check for orphaned nodes (not connected to graph)
  const orphans = findOrphanedNodes(nodes, edges);
  for (const nodeId of orphans) {
    warnings.push({
      nodeId,
      message: `Node is disconnected from the workflow`,
    });
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

function detectCycles(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): { hasCycle: boolean } {
  // Kahn's algorithm for topological sort
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize
  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  // Build graph
  for (const edge of edges) {
    const current = inDegree.get(edge.target) ?? 0;
    inDegree.set(edge.target, current + 1);
    adjacency.get(edge.source)?.push(edge.target);
  }

  // Find nodes with no incoming edges
  const queue: string[] = [];
  for (const [nodeId, degree] of inDegree) {
    if (degree === 0) queue.push(nodeId);
  }

  let processed = 0;
  while (queue.length > 0) {
    const current = queue.shift()!;
    processed++;

    for (const neighbor of adjacency.get(current) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  return { hasCycle: processed !== nodes.length };
}

function findOrphanedNodes(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
): string[] {
  if (nodes.length <= 1) return [];

  const connected = new Set<string>();

  // Add all nodes that are part of any edge
  for (const edge of edges) {
    connected.add(edge.source);
    connected.add(edge.target);
  }

  // Find nodes not in any edge
  return nodes
    .filter((node) => !connected.has(node.id))
    .map((node) => node.id);
}
```

### Step 4: Run test to verify it passes

Run: `cd frontend && bun test src/lib/workflow/validation.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add frontend/src/lib/workflow/validation.ts frontend/src/lib/workflow/validation.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): add workflow validation before save

Validates node configs, detects cycles, warns about orphans.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Extend Zustand Store with Dirty State and Workflow Metadata

**Files:**
- Modify: `frontend/src/stores/workflowBuilderStore.ts`
- Modify: `frontend/src/stores/workflowBuilderStore.test.ts`

### Step 1: Write the failing test

```typescript
// Add to workflowBuilderStore.test.ts

describe('workflow metadata', () => {
  it('tracks workflow id', () => {
    const store = useWorkflowBuilderStore.getState();
    store.setWorkflowId('workflow-123');

    expect(useWorkflowBuilderStore.getState().workflowId).toBe('workflow-123');
  });

  it('tracks workflow name', () => {
    const store = useWorkflowBuilderStore.getState();
    store.setWorkflowName('My Workflow');

    expect(useWorkflowBuilderStore.getState().workflowName).toBe('My Workflow');
  });

  it('tracks workflow description', () => {
    const store = useWorkflowBuilderStore.getState();
    store.setWorkflowDescription('A test workflow');

    expect(useWorkflowBuilderStore.getState().workflowDescription).toBe('A test workflow');
  });
});

describe('dirty state tracking', () => {
  it('starts clean', () => {
    const store = useWorkflowBuilderStore.getState();
    expect(store.isDirty).toBe(false);
  });

  it('becomes dirty when node added', () => {
    const store = useWorkflowBuilderStore.getState();
    store.addNode({ id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: {} });

    expect(useWorkflowBuilderStore.getState().isDirty).toBe(true);
  });

  it('becomes dirty when name changes', () => {
    const store = useWorkflowBuilderStore.getState();
    store.setWorkflowName('New Name');

    expect(useWorkflowBuilderStore.getState().isDirty).toBe(true);
  });

  it('can mark as clean', () => {
    const store = useWorkflowBuilderStore.getState();
    store.addNode({ id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: {} });
    store.markClean();

    expect(useWorkflowBuilderStore.getState().isDirty).toBe(false);
  });
});

describe('loadWorkflow', () => {
  it('loads workflow data and marks clean', () => {
    const store = useWorkflowBuilderStore.getState();
    const nodes: WorkflowNode[] = [
      { id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: {} },
    ];
    const edges: WorkflowEdge[] = [];

    store.loadWorkflow({
      id: 'wf-123',
      name: 'Test Workflow',
      description: 'A test',
      nodes,
      edges,
    });

    const state = useWorkflowBuilderStore.getState();
    expect(state.workflowId).toBe('wf-123');
    expect(state.workflowName).toBe('Test Workflow');
    expect(state.workflowDescription).toBe('A test');
    expect(state.nodes).toEqual(nodes);
    expect(state.edges).toEqual(edges);
    expect(state.isDirty).toBe(false);
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd frontend && bun test src/stores/workflowBuilderStore.test.ts`
Expected: FAIL - properties/methods not found

### Step 3: Update store implementation

```typescript
// Update workflowBuilderStore.ts - add to interface and implementation

// Add to WorkflowBuilderState interface:
workflowId: string | null;
workflowName: string;
workflowDescription: string;
isDirty: boolean;

setWorkflowId: (id: string | null) => void;
setWorkflowName: (name: string) => void;
setWorkflowDescription: (description: string) => void;
markClean: () => void;
loadWorkflow: (data: {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}) => void;

// Add to initialState:
workflowId: null as string | null,
workflowName: 'Untitled Workflow',
workflowDescription: '',
isDirty: false,

// Add implementations in create():
setWorkflowId: (id) => set({ workflowId: id }),

setWorkflowName: (name) => set({ workflowName: name, isDirty: true }),

setWorkflowDescription: (description) => set({ workflowDescription: description, isDirty: true }),

markClean: () => set({ isDirty: false }),

loadWorkflow: (data) => set({
  workflowId: data.id,
  workflowName: data.name,
  workflowDescription: data.description,
  nodes: data.nodes,
  edges: data.edges,
  history: [{ nodes: data.nodes, edges: data.edges }],
  historyIndex: 0,
  isDirty: false,
  selectedNode: null,
}),

// Update addNode, updateNode, deleteNode, addEdge, deleteEdge to set isDirty: true

// Update reset to include new fields:
reset: () => {
  set({
    nodes: [],
    edges: [],
    selectedNode: null,
    history: [{ nodes: [], edges: [] }],
    historyIndex: 0,
    maxHistorySize: 50,
    workflowId: null,
    workflowName: 'Untitled Workflow',
    workflowDescription: '',
    isDirty: false,
  });
},
```

### Step 4: Run test to verify it passes

Run: `cd frontend && bun test src/stores/workflowBuilderStore.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add frontend/src/stores/workflowBuilderStore.ts frontend/src/stores/workflowBuilderStore.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): add workflow metadata and dirty tracking to store

Tracks workflow id/name/description, isDirty state, loadWorkflow.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Create useWorkflowMutations Hook

**Files:**
- Create: `frontend/src/hooks/useWorkflowMutations.ts`
- Test: `frontend/src/hooks/useWorkflowMutations.test.ts`

### Step 1: Write the failing test

```typescript
// frontend/src/hooks/useWorkflowMutations.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useWorkflowMutations } from './useWorkflowMutations';
import { api } from '@/api/client';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore';

vi.mock('@/api/client', () => ({
  api: {
    workflows: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe('useWorkflowMutations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorkflowBuilderStore.getState().reset();
  });

  it('creates new workflow when no workflowId', async () => {
    const mockWorkflow = { id: 'new-id', name: 'Test', definition: {} };
    vi.mocked(api.workflows.create).mockResolvedValue({ data: mockWorkflow });

    const store = useWorkflowBuilderStore.getState();
    store.setWorkflowName('Test Workflow');
    store.addNode({ id: 'n1', type: 'agent', position: { x: 0, y: 0 }, data: { agentId: '123e4567-e89b-12d3-a456-426614174000' } });

    const { result } = renderHook(() => useWorkflowMutations(), { wrapper: createWrapper() });

    await result.current.saveWorkflow();

    await waitFor(() => {
      expect(api.workflows.create).toHaveBeenCalled();
    });
  });

  it('updates existing workflow when workflowId exists', async () => {
    const mockWorkflow = { id: 'existing-id', name: 'Test', definition: {} };
    vi.mocked(api.workflows.update).mockResolvedValue({ data: mockWorkflow });

    const store = useWorkflowBuilderStore.getState();
    store.setWorkflowId('existing-id');
    store.setWorkflowName('Test Workflow');

    const { result } = renderHook(() => useWorkflowMutations(), { wrapper: createWrapper() });

    await result.current.saveWorkflow();

    await waitFor(() => {
      expect(api.workflows.update).toHaveBeenCalledWith('existing-id', expect.any(Object));
    });
  });

  it('returns validation errors', async () => {
    const store = useWorkflowBuilderStore.getState();
    // Add node with missing required field
    store.addNode({ id: 'n1', type: 'agent', position: { x: 0, y: 0 }, data: {} });

    const { result } = renderHook(() => useWorkflowMutations(), { wrapper: createWrapper() });

    const saveResult = await result.current.saveWorkflow();

    expect(saveResult.success).toBe(false);
    expect(saveResult.validationResult?.errors.length).toBeGreaterThan(0);
  });
});
```

### Step 2: Run test to verify it fails

Run: `cd frontend && bun test src/hooks/useWorkflowMutations.test.ts`
Expected: FAIL - module not found

### Step 3: Write implementation

```typescript
// frontend/src/hooks/useWorkflowMutations.ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useWorkflowBuilderStore } from '@/stores/workflowBuilderStore';
import { toBackendFormat } from '@/lib/workflow/serialization';
import { validateWorkflow, type WorkflowValidationResult } from '@/lib/workflow/validation';

interface SaveResult {
  success: boolean;
  workflowId?: string;
  validationResult?: WorkflowValidationResult;
  error?: Error;
}

export function useWorkflowMutations() {
  const queryClient = useQueryClient();

  const {
    workflowId,
    workflowName,
    workflowDescription,
    nodes,
    edges,
    setWorkflowId,
    markClean,
  } = useWorkflowBuilderStore();

  const createMutation = useMutation({
    mutationFn: api.workflows.create,
    onSuccess: (data) => {
      setWorkflowId(data.data.id);
      markClean();
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Parameters<typeof api.workflows.update>[1]) =>
      api.workflows.update(id, input),
    onSuccess: () => {
      markClean();
      queryClient.invalidateQueries({ queryKey: ['workflows'] });
      queryClient.invalidateQueries({ queryKey: ['workflow', workflowId] });
    },
  });

  const saveWorkflow = async (): Promise<SaveResult> => {
    // Validate first
    const validationResult = validateWorkflow(nodes, edges);
    if (!validationResult.isValid) {
      return { success: false, validationResult };
    }

    const definition = toBackendFormat(nodes, edges);

    try {
      if (workflowId) {
        // Update existing
        await updateMutation.mutateAsync({
          id: workflowId,
          name: workflowName,
          description: workflowDescription || undefined,
          definition,
        });
        return { success: true, workflowId };
      } else {
        // Create new
        const result = await createMutation.mutateAsync({
          name: workflowName,
          description: workflowDescription || undefined,
          definition,
        });
        return { success: true, workflowId: result.data.id };
      }
    } catch (error) {
      return { success: false, error: error as Error };
    }
  };

  return {
    saveWorkflow,
    isSaving: createMutation.isPending || updateMutation.isPending,
    saveError: createMutation.error || updateMutation.error,
  };
}
```

### Step 4: Run test to verify it passes

Run: `cd frontend && bun test src/hooks/useWorkflowMutations.test.ts`
Expected: PASS

### Step 5: Commit

```bash
git add frontend/src/hooks/useWorkflowMutations.ts frontend/src/hooks/useWorkflowMutations.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): add useWorkflowMutations hook for save/update

Handles create/update with validation and React Query integration.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Update WorkflowBuilderPage to Use New Store and Hooks

**Files:**
- Modify: `frontend/src/pages/WorkflowBuilderPage.tsx`

### Step 1: Read current implementation (no test needed - integration task)

The page already has save logic but uses local state. We need to integrate with the store and hook.

### Step 2: Update implementation

```typescript
// frontend/src/pages/WorkflowBuilderPage.tsx
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { WorkflowCanvas } from '../components/workflow/WorkflowCanvas';
import { NodePalette } from '../components/workflow/NodePalette';
import { NodeConfigPanel } from '../components/workflow/NodeConfigPanel';
import { Button } from '../components/Button';
import { useWorkflowBuilderStore } from '../stores/workflowBuilderStore';
import { useWorkflowMutations } from '../hooks/useWorkflowMutations';
import { fromBackendFormat, type BackendWorkflowDefinition } from '../lib/workflow/serialization';

export function WorkflowBuilderPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEditMode = Boolean(id);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);

  const {
    reset,
    loadWorkflow,
    selectedNode,
    workflowName,
    workflowDescription,
    setWorkflowName,
    setWorkflowDescription,
    isDirty,
  } = useWorkflowBuilderStore();

  const { saveWorkflow, isSaving } = useWorkflowMutations();

  // Load existing workflow in edit mode
  const { data: workflow, isLoading } = useQuery({
    queryKey: ['workflow', id],
    queryFn: () => api.workflows.get(id!),
    enabled: isEditMode,
  });

  // Initialize workflow data when loaded
  useEffect(() => {
    if (workflow?.data) {
      const definition = workflow.data.definition as BackendWorkflowDefinition;
      const { nodes, edges } = fromBackendFormat(definition);

      loadWorkflow({
        id: workflow.data.id,
        name: workflow.data.name,
        description: workflow.data.description || '',
        nodes,
        edges,
      });
    }
  }, [workflow, loadWorkflow]);

  // Reset store on unmount
  useEffect(() => {
    return () => reset();
  }, [reset]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  const handleSave = async () => {
    setValidationErrors([]);
    const result = await saveWorkflow();

    if (!result.success) {
      if (result.validationResult) {
        setValidationErrors(result.validationResult.errors.map((e) => e.message));
      } else if (result.error) {
        setValidationErrors([result.error.message]);
      }
      return;
    }

    // Navigate to edit mode if was creating new
    if (!isEditMode && result.workflowId) {
      navigate(`/workflows/${result.workflowId}/edit`, { replace: true });
    }
  };

  const handleCancel = () => {
    if (isDirty && !confirm('Discard unsaved changes?')) {
      return;
    }
    navigate('/');
  };

  if (isEditMode && isLoading) {
    return <div className="flex items-center justify-center h-screen">Loading...</div>;
  }

  return (
    <div className="fixed inset-0 bg-gray-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4 flex-1">
          <input
            type="text"
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            className="text-xl font-semibold border-none focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-2 py-1"
            placeholder="Workflow name"
          />
          {isDirty && <span className="text-sm text-gray-500">(unsaved)</span>}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={handleCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : isEditMode ? 'Save' : 'Create'}
          </Button>
        </div>
      </header>

      {/* Validation Errors */}
      {validationErrors.length > 0 && (
        <div className="bg-red-50 border-b border-red-200 px-4 py-2">
          <ul className="text-sm text-red-600">
            {validationErrors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Node Palette Sidebar */}
        <aside className="w-64 bg-white border-r border-gray-200 overflow-y-auto">
          <NodePalette />
        </aside>

        {/* Canvas */}
        <main className="flex-1 relative">
          <WorkflowCanvas />
        </main>

        {/* Node Config Panel - shows when node is selected */}
        {selectedNode && (
          <aside className="w-80 bg-white border-l border-gray-200 overflow-y-auto">
            <NodeConfigPanel />
          </aside>
        )}
      </div>
    </div>
  );
}
```

### Step 3: Run full test suite

Run: `cd frontend && bun test`
Expected: All tests PASS

### Step 4: Manual verification

Run: `make dev-frontend`
- Create new workflow, add nodes, save
- Edit existing workflow, modify, save
- Verify dirty state indicator
- Verify unsaved changes warning

### Step 5: Commit

```bash
git add frontend/src/pages/WorkflowBuilderPage.tsx
git commit -m "$(cat <<'EOF'
feat(frontend): integrate save/load in WorkflowBuilderPage

Uses store for state, mutations hook for save, dirty tracking.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Add Auto-Layout on Load

**Files:**
- Modify: `frontend/src/pages/WorkflowBuilderPage.tsx`
- Modify: `frontend/src/lib/workflow/serialization.ts`

### Step 1: Write test for layout integration

```typescript
// Add to serialization.test.ts

import { applyAutoLayout } from '@/lib/autoLayout';

describe('fromBackendFormat with auto-layout', () => {
  it('positions nodes using dagre when loading', () => {
    const definition: BackendWorkflowDefinition = {
      nodes: [
        { id: 'node-1', type: 'agent', agentId: '123e4567-e89b-12d3-a456-426614174000', input: {} },
        { id: 'node-2', type: 'agent', agentId: '123e4567-e89b-12d3-a456-426614174000', input: {} },
      ],
      edges: [{ id: 'edge-1', from: 'node-1', to: 'node-2' }],
    };

    const { nodes, edges } = fromBackendFormat(definition);
    const layoutedNodes = applyAutoLayout(nodes, edges);

    // Dagre should position node-2 below node-1
    expect(layoutedNodes[1].position.y).toBeGreaterThan(layoutedNodes[0].position.y);
  });
});
```

### Step 2: Run test to verify current behavior

Run: `cd frontend && bun test src/lib/workflow/serialization.test.ts`
Expected: FAIL or positions not optimal

### Step 3: Update WorkflowBuilderPage to apply layout

```typescript
// In WorkflowBuilderPage.tsx, update the workflow loading effect:

import { applyAutoLayout } from '../lib/autoLayout';

// In the useEffect that loads workflow:
useEffect(() => {
  if (workflow?.data) {
    const definition = workflow.data.definition as BackendWorkflowDefinition;
    const { nodes, edges } = fromBackendFormat(definition);

    // Apply auto-layout to position nodes
    const layoutedNodes = applyAutoLayout(nodes, edges);

    loadWorkflow({
      id: workflow.data.id,
      name: workflow.data.name,
      description: workflow.data.description || '',
      nodes: layoutedNodes,
      edges,
    });
  }
}, [workflow, loadWorkflow]);
```

### Step 4: Run test to verify it passes

Run: `cd frontend && bun test`
Expected: PASS

### Step 5: Commit

```bash
git add frontend/src/pages/WorkflowBuilderPage.tsx frontend/src/lib/workflow/serialization.test.ts
git commit -m "$(cat <<'EOF'
feat(frontend): apply auto-layout when loading workflows

Uses Dagre to position nodes on load for clean visualization.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Fix Backend Schema Compatibility

**Files:**
- Modify: `frontend/src/api/client.ts`

### Step 1: Update types to match backend schema

The backend expects `triggers` and `errorStrategy` fields. Update the client types.

```typescript
// frontend/src/api/client.ts - update CreateWorkflowInput

export interface CreateWorkflowInput {
  name: string;
  description?: string;
  definition: Record<string, unknown>;
  triggers?: Array<{ type: 'manual' } | { type: 'schedule'; cron: string } | { type: 'webhook'; secret: string } | { type: 'api' }>;
  errorStrategy?: {
    retries?: number;
    retryDelay?: number;
    fallbackNodeId?: string;
    onFailure?: 'stop' | 'continue' | 'human-review';
  };
}
```

### Step 2: Update useWorkflowMutations to include defaults

```typescript
// In useWorkflowMutations.ts saveWorkflow:

if (workflowId) {
  await updateMutation.mutateAsync({
    id: workflowId,
    name: workflowName,
    description: workflowDescription || undefined,
    definition,
  });
} else {
  const result = await createMutation.mutateAsync({
    name: workflowName,
    description: workflowDescription || undefined,
    definition,
    triggers: [{ type: 'manual' }],
    errorStrategy: {
      retries: 0,
      retryDelay: 5000,
      onFailure: 'stop',
    },
  });
}
```

### Step 3: Test with backend

Run: `make dev`
- Create workflow and verify save works
- Check database has correct data

### Step 4: Commit

```bash
git add frontend/src/api/client.ts frontend/src/hooks/useWorkflowMutations.ts
git commit -m "$(cat <<'EOF'
fix(frontend): add triggers and errorStrategy for backend compat

Backend schema requires these fields for workflow creation.

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Final Integration Test and Cleanup

**Files:**
- No new files - integration testing

### Step 1: Run full test suite

Run: `cd frontend && bun test`
Expected: All PASS

### Step 2: Run linting

Run: `cd frontend && bun run lint`
Expected: No errors

### Step 3: Manual E2E verification

1. Start dev environment: `make dev`
2. Navigate to workflow builder
3. Create new workflow with multiple nodes
4. Save - verify success
5. Navigate away, come back - verify workflow loads
6. Edit and save again
7. Verify dirty state tracking works
8. Verify validation prevents invalid saves

### Step 4: Final commit

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(frontend): Phase 4 - Save/Publish workflows complete

- Serialization utils for React Flow <-> backend format
- Workflow validation with cycle detection
- Zustand store extensions for metadata and dirty tracking
- React Query mutations for save/update
- Auto-layout on workflow load
- Validation error display
- Unsaved changes warning

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>
EOF
)"
```

---

## Summary

This plan implements Phase 4 (Save/Publish) with:

1. **Serialization** - Convert between React Flow and backend formats
2. **Validation** - Client-side checks before save (node config, cycles, orphans)
3. **Store Extensions** - Workflow metadata, dirty tracking, loadWorkflow
4. **Mutations Hook** - React Query integration for create/update
5. **Page Integration** - Full save/load flow with UX polish
6. **Backend Compat** - Proper schema alignment

Total: 9 tasks, ~35 steps, TDD throughout.
