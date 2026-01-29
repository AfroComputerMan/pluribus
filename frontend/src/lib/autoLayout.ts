/**
 * Auto-Layout Utility
 * Uses Dagre to calculate hierarchical node positions for workflow DAGs
 */

import dagre from '@dagrejs/dagre';
import type { Node, Edge } from '@xyflow/react';

export interface LayoutOptions {
  direction?: 'TB' | 'LR' | 'BT' | 'RL';
  nodeWidth?: number;
  nodeHeight?: number;
  rankSeparation?: number;
  nodeSeparation?: number;
}

const defaultOptions: Required<LayoutOptions> = {
  direction: 'TB', // Top to Bottom
  nodeWidth: 200,
  nodeHeight: 100,
  rankSeparation: 100,
  nodeSeparation: 50,
};

/**
 * Apply Dagre layout algorithm to nodes and edges
 * @param nodes - Array of React Flow nodes
 * @param edges - Array of React Flow edges
 * @param options - Layout configuration options
 * @returns Nodes with updated x/y positions
 */
export function applyDagreLayout<T extends Node>(
  nodes: T[],
  edges: Edge[],
  options: LayoutOptions = {},
): T[] {
  const opts = { ...defaultOptions, ...options };

  // Create a new directed graph
  const graph = new dagre.graphlib.Graph();

  // Set graph configuration
  graph.setGraph({
    rankdir: opts.direction,
    ranksep: opts.rankSeparation,
    nodesep: opts.nodeSeparation,
  });

  // Default edge configuration
  graph.setDefaultEdgeLabel(() => ({}));

  // Add nodes to graph
  nodes.forEach((node) => {
    graph.setNode(node.id, {
      width: opts.nodeWidth,
      height: opts.nodeHeight,
    });
  });

  // Add edges to graph
  edges.forEach((edge) => {
    graph.setEdge(edge.source, edge.target);
  });

  // Calculate layout
  dagre.layout(graph);

  // Update node positions based on Dagre layout
  return nodes.map((node) => {
    const dagreNode = graph.node(node.id);

    // Dagre positions are centered, adjust to top-left
    const position = {
      x: dagreNode.x - opts.nodeWidth / 2,
      y: dagreNode.y - opts.nodeHeight / 2,
    };

    return {
      ...node,
      position,
    };
  });
}

/**
 * Calculate bounding box for a set of nodes
 * Useful for centering the viewport
 */
export function getNodesBounds(nodes: Node[]) {
  if (nodes.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  nodes.forEach((node) => {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x);
    maxY = Math.max(maxY, node.position.y);
  });

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
