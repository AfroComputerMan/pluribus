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
  })
})
