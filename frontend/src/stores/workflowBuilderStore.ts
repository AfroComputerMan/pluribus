/**
 * Workflow Builder Store
 * Manages workflow builder canvas state with Zustand
 */

import { create } from 'zustand';
import type { Node, Edge } from '@xyflow/react';

export interface WorkflowNode extends Node {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: {
    label?: string;
    config?: Record<string, unknown>;
  };
}

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
  nodes: [],
  edges: [],
  selectedNode: null,
  history: [],
  historyIndex: -1,
  maxHistorySize: 50,
};

export const useWorkflowBuilderStore = create<WorkflowBuilderState>(
  (set, get) => ({
    ...initialState,

    // Save current state to history before making changes
    _saveToHistory: () => {
      const { nodes, edges, history, historyIndex, maxHistorySize } = get();

      // Remove any future history if we're not at the end
      const newHistory = history.slice(0, historyIndex + 1);

      // Add current state
      newHistory.push({ nodes: [...nodes], edges: [...edges] });

      // Limit history size
      if (newHistory.length > maxHistorySize) {
        newHistory.shift();
      }

      set({
        history: newHistory,
        historyIndex: newHistory.length - 1,
      });
    },

    addNode: (node) => {
      get()._saveToHistory();
      set((state) => ({
        nodes: [...state.nodes, node],
      }));
    },

    updateNode: (id, updates) => {
      get()._saveToHistory();
      set((state) => ({
        nodes: state.nodes.map((node) =>
          node.id === id ? { ...node, ...updates } : node,
        ),
      }));
    },

    deleteNode: (id) => {
      get()._saveToHistory();
      set((state) => ({
        nodes: state.nodes.filter((node) => node.id !== id),
        edges: state.edges.filter(
          (edge) => edge.source !== id && edge.target !== id,
        ),
        selectedNode: state.selectedNode === id ? null : state.selectedNode,
      }));
    },

    setSelectedNode: (id) => {
      set({ selectedNode: id });
    },

    addEdge: (edge) => {
      get()._saveToHistory();
      set((state) => ({
        edges: [...state.edges, edge],
      }));
    },

    deleteEdge: (id) => {
      get()._saveToHistory();
      set((state) => ({
        edges: state.edges.filter((edge) => edge.id !== id),
      }));
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
      set(initialState);
    },

    // Private method for saving to history
    _saveToHistory: () => {},
  }),
);
