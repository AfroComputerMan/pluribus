/**
 * WorkflowCanvas
 * React Flow canvas for visual workflow editing
 */

import { useCallback, useEffect, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  type Connection,
  type NodeTypes,
  type OnNodesChange,
  type OnEdgesChange,
  type Node,
  type Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  useWorkflowBuilderStore,
  type WorkflowNode,
  type WorkflowEdge,
  type WorkflowNodeData,
} from '../../stores/workflowBuilderStore';
import { applyDagreLayout } from '../../lib/autoLayout';
import { AgentNode } from './nodes/AgentNode';
import { ConditionNode } from './nodes/ConditionNode';
import { ParallelNode } from './nodes/ParallelNode';
import { LoopNode } from './nodes/LoopNode';
import { HumanReviewNode } from './nodes/HumanReviewNode';

// Define custom node types
const nodeTypes: NodeTypes = {
  agent: AgentNode,
  condition: ConditionNode,
  parallel: ParallelNode,
  loop: LoopNode,
  'human-review': HumanReviewNode,
};

function WorkflowCanvasInner() {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  const {
    nodes: storeNodes,
    edges: storeEdges,
    setNodes: setStoreNodes,
    addEdge: addStoreEdge,
  } = useWorkflowBuilderStore();

  // Use React Flow hooks for local state
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<WorkflowNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Sync store nodes/edges with React Flow state
  useEffect(() => {
    setNodes(storeNodes as Node<WorkflowNodeData>[]);
  }, [storeNodes, setNodes]);

  useEffect(() => {
    setEdges(storeEdges as Edge[]);
  }, [storeEdges, setEdges]);

  // Apply auto-layout on initial load when nodes are added
  useEffect(() => {
    if (
      nodes.length > 0 &&
      nodes.every((n) => !n.position || (n.position.x === 0 && n.position.y === 0))
    ) {
      const layoutedNodes = applyDagreLayout(nodes, edges);
      setNodes(layoutedNodes as Node<WorkflowNodeData>[]);
      setStoreNodes(layoutedNodes as WorkflowNode[]);
    }
  }, [nodes.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle node changes (position, selection, etc.)
  const handleNodesChange: OnNodesChange<Node<WorkflowNodeData>> = useCallback(
    (changes) => {
      onNodesChange(changes);
      // Sync position changes back to store after dragging
      const positionChanges = changes.filter(
        (c): c is { type: 'position'; id: string; position: { x: number; y: number } } =>
          c.type === 'position' && 'position' in c && c.position !== undefined,
      );
      if (positionChanges.length > 0) {
        setNodes((currentNodes) => {
          const updatedNodes = currentNodes.map((node) => {
            const change = positionChanges.find((c) => c.id === node.id);
            if (change) {
              return { ...node, position: change.position };
            }
            return node;
          });
          setStoreNodes(updatedNodes as WorkflowNode[]);
          return updatedNodes;
        });
      }
    },
    [onNodesChange, setNodes, setStoreNodes],
  );

  // Handle edge changes
  const handleEdgesChange: OnEdgesChange<Edge> = useCallback(
    (changes) => {
      onEdgesChange(changes);
    },
    [onEdgesChange],
  );

  // Handle edge connection
  const onConnect = useCallback(
    (connection: Connection) => {
      const newEdge: WorkflowEdge = {
        id: `e${connection.source}-${connection.target}`,
        source: connection.source!,
        target: connection.target!,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
      };
      setEdges((eds) => addEdge(connection, eds));
      addStoreEdge(newEdge);
    },
    [setEdges, addStoreEdge],
  );

  // Handle drop event from node palette
  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      if (!type) return;

      // Get position relative to the React Flow canvas
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });

      const nodeId = `${type}_${Date.now()}`;
      const newNode: Node<WorkflowNodeData> = {
        id: nodeId,
        type,
        position,
        data: {
          label: `${type.charAt(0).toUpperCase() + type.slice(1).replace('-', ' ')} Node`,
          // Default data based on type
          ...(type === 'agent' && { agentId: '', input: {}, timeout: 300 }),
          ...(type === 'condition' && { expression: '', trueBranch: '', falseBranch: '' }),
          ...(type === 'parallel' && { branches: [], joinStrategy: 'all' }),
          ...(type === 'loop' && { condition: '', maxIterations: 10, body: '' }),
          ...(type === 'human-review' && { prompt: '', timeout: 3600 }),
        },
      };

      setNodes((nds) => [...nds, newNode]);
      setStoreNodes([...nodes, newNode] as WorkflowNode[]);
    },
    [screenToFlowPosition, setNodes, setStoreNodes, nodes],
  );

  return (
    <div ref={reactFlowWrapper} className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onDragOver={onDragOver}
        onDrop={onDrop}
        nodeTypes={nodeTypes}
        fitView
        minZoom={0.1}
        maxZoom={2}
      >
        <Background color="#e5e7eb" gap={16} />
        <Controls />
        <MiniMap
          nodeColor="#94a3b8"
          maskColor="rgb(240, 240, 240, 0.6)"
          className="bg-white border border-gray-200 rounded"
        />
      </ReactFlow>
    </div>
  );
}

export function WorkflowCanvas() {
  return (
    <ReactFlowProvider>
      <WorkflowCanvasInner />
    </ReactFlowProvider>
  );
}
