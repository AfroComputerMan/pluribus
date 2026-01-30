import { describe, it, expect, beforeEach } from 'vitest'
import { useWorkflowBuilderStore, type WorkflowNode, type WorkflowEdge } from './workflowBuilderStore'

describe('workflowBuilderStore', () => {
  beforeEach(() => {
    // Reset store before each test
    useWorkflowBuilderStore.getState().reset()
  })

  describe('node operations', () => {
    it('adds a node', () => {
      const store = useWorkflowBuilderStore.getState()
      const node: WorkflowNode = {
        id: 'node-1',
        type: 'agent',
        position: { x: 100, y: 100 },
        data: { label: 'Test Node' },
      }

      store.addNode(node)

      const state = useWorkflowBuilderStore.getState()
      expect(state.nodes).toHaveLength(1)
      expect(state.nodes[0]).toEqual(node)
    })

    it('updates a node', () => {
      const store = useWorkflowBuilderStore.getState()
      const node: WorkflowNode = {
        id: 'node-1',
        type: 'agent',
        position: { x: 100, y: 100 },
        data: { label: 'Original' },
      }
      store.addNode(node)

      store.updateNode('node-1', { data: { label: 'Updated' } })

      const state = useWorkflowBuilderStore.getState()
      expect(state.nodes[0].data.label).toBe('Updated')
    })

    it('deletes a node', () => {
      const store = useWorkflowBuilderStore.getState()
      const node: WorkflowNode = {
        id: 'node-1',
        type: 'agent',
        position: { x: 100, y: 100 },
        data: {},
      }
      store.addNode(node)

      store.deleteNode('node-1')

      const state = useWorkflowBuilderStore.getState()
      expect(state.nodes).toHaveLength(0)
    })

    it('deletes connected edges when node is deleted', () => {
      const store = useWorkflowBuilderStore.getState()
      store.addNode({ id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: {} })
      store.addNode({ id: 'node-2', type: 'agent', position: { x: 0, y: 100 }, data: {} })
      store.addEdge({ id: 'edge-1', source: 'node-1', target: 'node-2' })

      store.deleteNode('node-1')

      const state = useWorkflowBuilderStore.getState()
      expect(state.edges).toHaveLength(0)
    })

    it('clears selection when selected node is deleted', () => {
      const store = useWorkflowBuilderStore.getState()
      store.addNode({ id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: {} })
      store.setSelectedNode('node-1')

      store.deleteNode('node-1')

      const state = useWorkflowBuilderStore.getState()
      expect(state.selectedNode).toBeNull()
    })
  })

  describe('edge operations', () => {
    it('adds an edge', () => {
      const store = useWorkflowBuilderStore.getState()
      const edge: WorkflowEdge = {
        id: 'edge-1',
        source: 'node-1',
        target: 'node-2',
      }

      store.addEdge(edge)

      const state = useWorkflowBuilderStore.getState()
      expect(state.edges).toHaveLength(1)
      expect(state.edges[0]).toEqual(edge)
    })

    it('deletes an edge', () => {
      const store = useWorkflowBuilderStore.getState()
      store.addEdge({ id: 'edge-1', source: 'node-1', target: 'node-2' })

      store.deleteEdge('edge-1')

      const state = useWorkflowBuilderStore.getState()
      expect(state.edges).toHaveLength(0)
    })
  })

  describe('selection', () => {
    it('sets selected node', () => {
      const store = useWorkflowBuilderStore.getState()

      store.setSelectedNode('node-1')

      const state = useWorkflowBuilderStore.getState()
      expect(state.selectedNode).toBe('node-1')
    })

    it('clears selection', () => {
      const store = useWorkflowBuilderStore.getState()
      store.setSelectedNode('node-1')

      store.setSelectedNode(null)

      const state = useWorkflowBuilderStore.getState()
      expect(state.selectedNode).toBeNull()
    })
  })

  describe('bulk operations', () => {
    it('sets nodes', () => {
      const store = useWorkflowBuilderStore.getState()
      const nodes: WorkflowNode[] = [
        { id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: {} },
        { id: 'node-2', type: 'condition', position: { x: 100, y: 100 }, data: {} },
      ]

      store.setNodes(nodes)

      const state = useWorkflowBuilderStore.getState()
      expect(state.nodes).toEqual(nodes)
    })

    it('sets edges', () => {
      const store = useWorkflowBuilderStore.getState()
      const edges: WorkflowEdge[] = [
        { id: 'edge-1', source: 'node-1', target: 'node-2' },
        { id: 'edge-2', source: 'node-2', target: 'node-3' },
      ]

      store.setEdges(edges)

      const state = useWorkflowBuilderStore.getState()
      expect(state.edges).toEqual(edges)
    })
  })

  describe('undo/redo', () => {
    it('cannot undo with no history', () => {
      const store = useWorkflowBuilderStore.getState()
      expect(store.canUndo()).toBe(false)
    })

    it('cannot redo with no future history', () => {
      const store = useWorkflowBuilderStore.getState()
      expect(store.canRedo()).toBe(false)
    })

    it('can undo after adding a node', () => {
      const store = useWorkflowBuilderStore.getState()
      store.addNode({ id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: {} })

      expect(useWorkflowBuilderStore.getState().canUndo()).toBe(true)
    })

    it('undoes node addition', () => {
      const store = useWorkflowBuilderStore.getState()
      store.addNode({ id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: {} })

      store.undo()

      const state = useWorkflowBuilderStore.getState()
      expect(state.nodes).toHaveLength(0)
    })

    it('redoes undone action', () => {
      const store = useWorkflowBuilderStore.getState()
      store.addNode({ id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: {} })
      store.undo()

      expect(useWorkflowBuilderStore.getState().canRedo()).toBe(true)
      store.redo()

      const state = useWorkflowBuilderStore.getState()
      expect(state.nodes).toHaveLength(1)
    })

    it('clears redo history on new action', () => {
      const store = useWorkflowBuilderStore.getState()
      store.addNode({ id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: {} })
      store.undo()

      // Add a different node
      store.addNode({ id: 'node-2', type: 'condition', position: { x: 100, y: 100 }, data: {} })

      expect(useWorkflowBuilderStore.getState().canRedo()).toBe(false)
    })

    it('limits history size', () => {
      const store = useWorkflowBuilderStore.getState()
      const maxSize = useWorkflowBuilderStore.getState().maxHistorySize

      // Add more nodes than max history size
      for (let i = 0; i < maxSize + 10; i++) {
        store.addNode({ id: `node-${i}`, type: 'agent', position: { x: i * 10, y: 0 }, data: {} })
      }

      const state = useWorkflowBuilderStore.getState()
      expect(state.history.length).toBeLessThanOrEqual(maxSize)
    })

    it('tracks edge operations in history', () => {
      const store = useWorkflowBuilderStore.getState()
      store.addEdge({ id: 'edge-1', source: 'node-1', target: 'node-2' })

      store.undo()

      const state = useWorkflowBuilderStore.getState()
      expect(state.edges).toHaveLength(0)
    })
  })

  describe('reset', () => {
    it('resets all state', () => {
      const store = useWorkflowBuilderStore.getState()
      store.addNode({ id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: {} })
      store.addEdge({ id: 'edge-1', source: 'node-1', target: 'node-2' })
      store.setSelectedNode('node-1')

      store.reset()

      const state = useWorkflowBuilderStore.getState()
      expect(state.nodes).toHaveLength(0)
      expect(state.edges).toHaveLength(0)
      expect(state.selectedNode).toBeNull()
      // History starts with initial empty state
      expect(state.history).toHaveLength(1)
      expect(state.history[0]).toEqual({ nodes: [], edges: [] })
      expect(state.historyIndex).toBe(0)
    })

    it('resets workflow metadata', () => {
      const store = useWorkflowBuilderStore.getState()
      store.setWorkflowId('workflow-123')
      store.setWorkflowName('My Workflow')
      store.setWorkflowDescription('A test workflow')

      store.reset()

      const state = useWorkflowBuilderStore.getState()
      expect(state.workflowId).toBeNull()
      expect(state.workflowName).toBe('Untitled Workflow')
      expect(state.workflowDescription).toBe('')
      expect(state.isDirty).toBe(false)
    })
  })

  describe('workflow metadata', () => {
    it('tracks workflow id', () => {
      const store = useWorkflowBuilderStore.getState()
      store.setWorkflowId('workflow-123')

      expect(useWorkflowBuilderStore.getState().workflowId).toBe('workflow-123')
    })

    it('tracks workflow name', () => {
      const store = useWorkflowBuilderStore.getState()
      store.setWorkflowName('My Workflow')

      expect(useWorkflowBuilderStore.getState().workflowName).toBe('My Workflow')
    })

    it('tracks workflow description', () => {
      const store = useWorkflowBuilderStore.getState()
      store.setWorkflowDescription('A test workflow')

      expect(useWorkflowBuilderStore.getState().workflowDescription).toBe('A test workflow')
    })
  })

  describe('dirty state tracking', () => {
    it('starts clean', () => {
      const store = useWorkflowBuilderStore.getState()
      expect(store.isDirty).toBe(false)
    })

    it('becomes dirty when node added', () => {
      const store = useWorkflowBuilderStore.getState()
      store.addNode({ id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: {} })

      expect(useWorkflowBuilderStore.getState().isDirty).toBe(true)
    })

    it('becomes dirty when node updated', () => {
      const store = useWorkflowBuilderStore.getState()
      store.addNode({ id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: {} })
      store.markClean()

      store.updateNode('node-1', { data: { label: 'Updated' } })

      expect(useWorkflowBuilderStore.getState().isDirty).toBe(true)
    })

    it('becomes dirty when node deleted', () => {
      const store = useWorkflowBuilderStore.getState()
      store.addNode({ id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: {} })
      store.markClean()

      store.deleteNode('node-1')

      expect(useWorkflowBuilderStore.getState().isDirty).toBe(true)
    })

    it('becomes dirty when edge added', () => {
      const store = useWorkflowBuilderStore.getState()
      store.markClean()

      store.addEdge({ id: 'edge-1', source: 'node-1', target: 'node-2' })

      expect(useWorkflowBuilderStore.getState().isDirty).toBe(true)
    })

    it('becomes dirty when edge deleted', () => {
      const store = useWorkflowBuilderStore.getState()
      store.addEdge({ id: 'edge-1', source: 'node-1', target: 'node-2' })
      store.markClean()

      store.deleteEdge('edge-1')

      expect(useWorkflowBuilderStore.getState().isDirty).toBe(true)
    })

    it('becomes dirty when name changes', () => {
      const store = useWorkflowBuilderStore.getState()
      store.setWorkflowName('New Name')

      expect(useWorkflowBuilderStore.getState().isDirty).toBe(true)
    })

    it('becomes dirty when description changes', () => {
      const store = useWorkflowBuilderStore.getState()
      store.setWorkflowDescription('New description')

      expect(useWorkflowBuilderStore.getState().isDirty).toBe(true)
    })

    it('can mark as clean', () => {
      const store = useWorkflowBuilderStore.getState()
      store.addNode({ id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: {} })
      store.markClean()

      expect(useWorkflowBuilderStore.getState().isDirty).toBe(false)
    })
  })

  describe('loadWorkflow', () => {
    it('loads workflow data and marks clean', () => {
      const store = useWorkflowBuilderStore.getState()
      const nodes: WorkflowNode[] = [
        { id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: {} },
      ]
      const edges: WorkflowEdge[] = []

      store.loadWorkflow({
        id: 'wf-123',
        name: 'Test Workflow',
        description: 'A test',
        nodes,
        edges,
      })

      const state = useWorkflowBuilderStore.getState()
      expect(state.workflowId).toBe('wf-123')
      expect(state.workflowName).toBe('Test Workflow')
      expect(state.workflowDescription).toBe('A test')
      expect(state.nodes).toEqual(nodes)
      expect(state.edges).toEqual(edges)
      expect(state.isDirty).toBe(false)
    })

    it('resets history when loading workflow', () => {
      const store = useWorkflowBuilderStore.getState()
      // Add some history first
      store.addNode({ id: 'old-node', type: 'agent', position: { x: 0, y: 0 }, data: {} })

      const nodes: WorkflowNode[] = [
        { id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: {} },
      ]
      store.loadWorkflow({
        id: 'wf-123',
        name: 'Test Workflow',
        description: 'A test',
        nodes,
        edges: [],
      })

      const state = useWorkflowBuilderStore.getState()
      expect(state.history).toHaveLength(1)
      expect(state.history[0]).toEqual({ nodes, edges: [] })
      expect(state.historyIndex).toBe(0)
      expect(state.canUndo()).toBe(false)
    })

    it('clears selected node when loading workflow', () => {
      const store = useWorkflowBuilderStore.getState()
      store.addNode({ id: 'node-1', type: 'agent', position: { x: 0, y: 0 }, data: {} })
      store.setSelectedNode('node-1')

      store.loadWorkflow({
        id: 'wf-123',
        name: 'Test Workflow',
        description: '',
        nodes: [],
        edges: [],
      })

      expect(useWorkflowBuilderStore.getState().selectedNode).toBeNull()
    })
  })
})
