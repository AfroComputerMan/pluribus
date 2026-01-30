/**
 * Workflow Builder Store
 * Manages workflow builder canvas state with Zustand
 */

import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';

export interface WorkflowNodeData extends Record<string, unknown> {
  label?: string;
  // Agent node fields
  agentId?: string;
  input?: Record<string, unknown>;
  timeout?: number;
  // Condition node fields
  expression?: string;
  trueBranch?: string;
  falseBranch?: string;
  // Parallel node fields
  branches?: string[];
  joinStrategy?: 'all' | 'any' | 'race';
  // Loop node fields
  condition?: string;
  maxIterations?: number;
  body?: string;
  // Human review node fields
  prompt?: string;
  options?: string[];
  // Generic config
  config?: Record<string, unknown>;
}

export type WorkflowNode = Node<WorkflowNodeData, string>;

export interface WorkflowEdge extends Edge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
}

interface HistoryState {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

interface WorkflowBuilderState {
  // Canvas state
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  selectedNode: string | null;

  // History for undo/redo
  history: HistoryState[];
  historyIndex: number;
  maxHistorySize: number;

  // Node operations
  addNode: (node: WorkflowNode) => void;
  updateNode: (id: string, updates: Partial<WorkflowNode>) => void;
  deleteNode: (id: string) => void;
  setSelectedNode: (id: string | null) => void;

  // Edge operations
  addEdge: (edge: WorkflowEdge) => void;
  deleteEdge: (id: string) => void;

  // Bulk operations
  setNodes: (nodes: WorkflowNode[]) => void;
  setEdges: (edges: WorkflowEdge[]) => void;

  // History operations
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Utility
  reset: () => void;
}

const initialState = {
  nodes: [] as WorkflowNode[],
  edges: [] as WorkflowEdge[],
  selectedNode: null as string | null,
  history: [{ nodes: [], edges: [] }] as HistoryState[],
  historyIndex: 0,
  maxHistorySize: 50,
};

// Helper function to save NEW state to history after mutation
function pushToHistory(
  newNodes: WorkflowNode[],
  newEdges: WorkflowEdge[],
  history: HistoryState[],
  historyIndex: number,
  maxHistorySize: number,
): { history: HistoryState[]; historyIndex: number } {
  // Remove any future history if we're not at the end (clears redo stack)
  const newHistory = history.slice(0, historyIndex + 1);

  // Add new state after mutation
  newHistory.push({ nodes: [...newNodes], edges: [...newEdges] });

  // Limit history size (remove oldest entries)
  while (newHistory.length > maxHistorySize) {
    newHistory.shift();
  }

  return {
    history: newHistory,
    historyIndex: newHistory.length - 1,
  };
}

export const useWorkflowBuilderStore = create<WorkflowBuilderState>(
  (set, get) => ({
    ...initialState,

    addNode: (node) => {
      const { nodes, edges, history, historyIndex, maxHistorySize } = get();
      const newNodes = [...nodes, node];
      const historyUpdate = pushToHistory(newNodes, edges, history, historyIndex, maxHistorySize);
      set({
        nodes: newNodes,
        ...historyUpdate,
      });
    },

    updateNode: (id, updates) => {
      const { nodes, edges, history, historyIndex, maxHistorySize } = get();
      const newNodes = nodes.map((node) =>
        node.id === id ? { ...node, ...updates } : node,
      );
      const historyUpdate = pushToHistory(newNodes, edges, history, historyIndex, maxHistorySize);
      set({
        nodes: newNodes,
        ...historyUpdate,
      });
    },

    deleteNode: (id) => {
      const { nodes, edges, history, historyIndex, maxHistorySize, selectedNode } = get();
      const newNodes = nodes.filter((node) => node.id !== id);
      const newEdges = edges.filter(
        (edge) => edge.source !== id && edge.target !== id,
      );
      const historyUpdate = pushToHistory(newNodes, newEdges, history, historyIndex, maxHistorySize);
      set({
        nodes: newNodes,
        edges: newEdges,
        selectedNode: selectedNode === id ? null : selectedNode,
        ...historyUpdate,
      });
    },

    setSelectedNode: (id) => {
      set({ selectedNode: id });
    },

    addEdge: (edge) => {
      const { nodes, edges, history, historyIndex, maxHistorySize } = get();
      const newEdges = [...edges, edge];
      const historyUpdate = pushToHistory(nodes, newEdges, history, historyIndex, maxHistorySize);
      set({
        edges: newEdges,
        ...historyUpdate,
      });
    },

    deleteEdge: (id) => {
      const { nodes, edges, history, historyIndex, maxHistorySize } = get();
      const newEdges = edges.filter((edge) => edge.id !== id);
      const historyUpdate = pushToHistory(nodes, newEdges, history, historyIndex, maxHistorySize);
      set({
        edges: newEdges,
        ...historyUpdate,
      });
    },

    setNodes: (nodes) => {
      set({ nodes });
    },

    setEdges: (edges) => {
      set({ edges });
    },

    undo: () => {
      const { history, historyIndex } = get();

      if (historyIndex > 0) {
        const previousState = history[historyIndex - 1];
        set({
          nodes: previousState.nodes,
          edges: previousState.edges,
          historyIndex: historyIndex - 1,
        });
      }
    },

    redo: () => {
      const { history, historyIndex } = get();

      if (historyIndex < history.length - 1) {
        const nextState = history[historyIndex + 1];
        set({
          nodes: nextState.nodes,
          edges: nextState.edges,
          historyIndex: historyIndex + 1,
        });
      }
    },

    canUndo: () => {
      const { historyIndex } = get();
      return historyIndex > 0;
    },

    canRedo: () => {
      const { history, historyIndex } = get();
      return historyIndex < history.length - 1;
    },

    reset: () => {
      set({
        nodes: [],
        edges: [],
        selectedNode: null,
        history: [{ nodes: [], edges: [] }],
        historyIndex: 0,
        maxHistorySize: 50,
      });
    },
  }),
);
