/**
 * WorkflowTemplatesPage
 * Displays pre-built workflow templates that users can load into the builder
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/Button';
import { useWorkflowBuilderStore, type WorkflowNode, type WorkflowEdge } from '../stores/workflowBuilderStore';

// Template definitions
interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  tags: string[];
}

const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: 'simple-pipeline',
    name: 'Simple Agent Pipeline',
    description: 'A sequential chain of agents for basic task processing',
    tags: ['basic', 'sequential'],
    nodes: [
      {
        id: 'agent-1',
        type: 'agent',
        position: { x: 100, y: 100 },
        data: { label: 'Input Processor', agentId: '', timeout: 30000 },
      },
      {
        id: 'agent-2',
        type: 'agent',
        position: { x: 100, y: 250 },
        data: { label: 'Data Transformer', agentId: '', timeout: 30000 },
      },
      {
        id: 'agent-3',
        type: 'agent',
        position: { x: 100, y: 400 },
        data: { label: 'Output Generator', agentId: '', timeout: 30000 },
      },
    ],
    edges: [
      { id: 'e1-2', source: 'agent-1', target: 'agent-2' },
      { id: 'e2-3', source: 'agent-2', target: 'agent-3' },
    ],
  },
  {
    id: 'conditional-routing',
    name: 'Conditional Routing',
    description: 'Route workflow based on conditions with true/false branches',
    tags: ['branching', 'conditional'],
    nodes: [
      {
        id: 'agent-input',
        type: 'agent',
        position: { x: 200, y: 50 },
        data: { label: 'Classify Input', agentId: '', timeout: 30000 },
      },
      {
        id: 'condition-1',
        type: 'condition',
        position: { x: 200, y: 200 },
        data: {
          label: 'Check Type',
          expression: 'input.type === "urgent"',
          trueBranch: 'agent-urgent',
          falseBranch: 'agent-normal',
        },
      },
      {
        id: 'agent-urgent',
        type: 'agent',
        position: { x: 50, y: 350 },
        data: { label: 'Urgent Handler', agentId: '', timeout: 15000 },
      },
      {
        id: 'agent-normal',
        type: 'agent',
        position: { x: 350, y: 350 },
        data: { label: 'Normal Handler', agentId: '', timeout: 60000 },
      },
    ],
    edges: [
      { id: 'e-in-cond', source: 'agent-input', target: 'condition-1' },
      { id: 'e-cond-urgent', source: 'condition-1', target: 'agent-urgent', sourceHandle: 'true' },
      { id: 'e-cond-normal', source: 'condition-1', target: 'agent-normal', sourceHandle: 'false' },
    ],
  },
  {
    id: 'parallel-processing',
    name: 'Parallel Processing',
    description: 'Execute multiple agents simultaneously and wait for all to complete',
    tags: ['parallel', 'performance'],
    nodes: [
      {
        id: 'agent-start',
        type: 'agent',
        position: { x: 200, y: 50 },
        data: { label: 'Prepare Data', agentId: '', timeout: 30000 },
      },
      {
        id: 'parallel-1',
        type: 'parallel',
        position: { x: 200, y: 200 },
        data: {
          label: 'Process in Parallel',
          branches: ['agent-a', 'agent-b', 'agent-c'],
          joinStrategy: 'all',
        },
      },
      {
        id: 'agent-a',
        type: 'agent',
        position: { x: 0, y: 350 },
        data: { label: 'Task A', agentId: '', timeout: 30000 },
      },
      {
        id: 'agent-b',
        type: 'agent',
        position: { x: 200, y: 350 },
        data: { label: 'Task B', agentId: '', timeout: 30000 },
      },
      {
        id: 'agent-c',
        type: 'agent',
        position: { x: 400, y: 350 },
        data: { label: 'Task C', agentId: '', timeout: 30000 },
      },
      {
        id: 'agent-merge',
        type: 'agent',
        position: { x: 200, y: 500 },
        data: { label: 'Merge Results', agentId: '', timeout: 30000 },
      },
    ],
    edges: [
      { id: 'e-start-par', source: 'agent-start', target: 'parallel-1' },
      { id: 'e-par-a', source: 'parallel-1', target: 'agent-a', sourceHandle: 'branch-0' },
      { id: 'e-par-b', source: 'parallel-1', target: 'agent-b', sourceHandle: 'branch-1' },
      { id: 'e-par-c', source: 'parallel-1', target: 'agent-c', sourceHandle: 'branch-2' },
      { id: 'e-a-merge', source: 'agent-a', target: 'agent-merge' },
      { id: 'e-b-merge', source: 'agent-b', target: 'agent-merge' },
      { id: 'e-c-merge', source: 'agent-c', target: 'agent-merge' },
    ],
  },
  {
    id: 'review-workflow',
    name: 'Review Workflow',
    description: 'Include human review step for quality control or approval',
    tags: ['human-in-loop', 'approval'],
    nodes: [
      {
        id: 'agent-generate',
        type: 'agent',
        position: { x: 150, y: 50 },
        data: { label: 'Generate Content', agentId: '', timeout: 60000 },
      },
      {
        id: 'review-1',
        type: 'humanReview',
        position: { x: 150, y: 200 },
        data: {
          label: 'Human Review',
          prompt: 'Please review the generated content',
          options: ['approve', 'reject', 'revise'],
        },
      },
      {
        id: 'agent-publish',
        type: 'agent',
        position: { x: 150, y: 350 },
        data: { label: 'Publish Content', agentId: '', timeout: 30000 },
      },
    ],
    edges: [
      { id: 'e-gen-review', source: 'agent-generate', target: 'review-1' },
      { id: 'e-review-pub', source: 'review-1', target: 'agent-publish' },
    ],
  },
  {
    id: 'data-processing-loop',
    name: 'Data Processing Loop',
    description: 'Iteratively process data until a condition is met',
    tags: ['loop', 'iteration', 'batch'],
    nodes: [
      {
        id: 'agent-init',
        type: 'agent',
        position: { x: 150, y: 50 },
        data: { label: 'Initialize', agentId: '', timeout: 30000 },
      },
      {
        id: 'loop-1',
        type: 'loop',
        position: { x: 150, y: 200 },
        data: {
          label: 'Process Items',
          condition: 'items.length > 0',
          maxIterations: 100,
          body: 'agent-process',
        },
      },
      {
        id: 'agent-process',
        type: 'agent',
        position: { x: 150, y: 350 },
        data: { label: 'Process Item', agentId: '', timeout: 30000 },
      },
      {
        id: 'agent-finalize',
        type: 'agent',
        position: { x: 150, y: 500 },
        data: { label: 'Finalize', agentId: '', timeout: 30000 },
      },
    ],
    edges: [
      { id: 'e-init-loop', source: 'agent-init', target: 'loop-1' },
      { id: 'e-loop-process', source: 'loop-1', target: 'agent-process', sourceHandle: 'body' },
      { id: 'e-process-loop', source: 'agent-process', target: 'loop-1' },
      { id: 'e-loop-final', source: 'loop-1', target: 'agent-finalize', sourceHandle: 'done' },
    ],
  },
];

export function WorkflowTemplatesPage() {
  const navigate = useNavigate();
  const { loadWorkflow, reset } = useWorkflowBuilderStore();
  const [searchTerm, setSearchTerm] = useState('');
  const [previewTemplate, setPreviewTemplate] = useState<WorkflowTemplate | null>(null);

  const filteredTemplates = WORKFLOW_TEMPLATES.filter(
    (template) =>
      template.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      template.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
      template.tags.some((tag) => tag.toLowerCase().includes(searchTerm.toLowerCase())),
  );

  const handleUseTemplate = (template: WorkflowTemplate) => {
    // Load template into store
    loadWorkflow({
      id: '',
      name: template.name,
      description: template.description,
      nodes: template.nodes,
      edges: template.edges,
    });

    // Navigate to builder
    navigate('/workflows/new');
  };

  const handleStartBlank = () => {
    reset();
    navigate('/workflows/new');
  };

  return (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Workflow Templates</h1>
        <Button variant="secondary" onClick={handleStartBlank}>
          Start from Scratch
        </Button>
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          placeholder="Search templates..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
      </div>

      {/* Template Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredTemplates.map((template) => (
          <div
            key={template.id}
            className="bg-white rounded-lg shadow border border-gray-200 overflow-hidden"
          >
            <div className="p-5">
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                {template.name}
              </h3>
              <p className="text-sm text-gray-600 mb-3">{template.description}</p>

              <div className="flex flex-wrap gap-1 mb-3">
                {template.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"
                  >
                    {tag}
                  </span>
                ))}
              </div>

              <p className="text-xs text-gray-500 mb-4">
                {template.nodes.length} nodes
              </p>

              <div className="flex gap-2">
                <Button
                  variant="primary"
                  onClick={() => handleUseTemplate(template)}
                  className="flex-1"
                >
                  Use Template
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setPreviewTemplate(template)}
                >
                  Preview
                </Button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Empty state */}
      {filteredTemplates.length === 0 && (
        <div className="bg-white shadow rounded-lg p-8 text-center text-gray-500">
          No templates match your search. Try a different term.
        </div>
      )}

      {/* Preview Modal */}
      {previewTemplate && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          role="dialog"
          aria-modal="true"
          onClick={() => setPreviewTemplate(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-gray-200">
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">
                    {previewTemplate.name}
                  </h2>
                  <p className="text-sm text-gray-600 mt-1">
                    {previewTemplate.description}
                  </p>
                </div>
                <button
                  onClick={() => setPreviewTemplate(null)}
                  className="text-gray-400 hover:text-gray-600"
                  aria-label="Close"
                >
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            <div className="p-6 overflow-y-auto max-h-[50vh]">
              <h3 className="text-sm font-medium text-gray-700 mb-3">
                Nodes ({previewTemplate.nodes.length})
              </h3>
              <div className="space-y-2">
                {previewTemplate.nodes.map((node) => (
                  <div
                    key={node.id}
                    className="flex items-center gap-3 p-3 bg-gray-50 rounded-md"
                  >
                    <span
                      className={`inline-block w-3 h-3 rounded-full ${
                        node.type === 'agent'
                          ? 'bg-blue-500'
                          : node.type === 'condition'
                            ? 'bg-yellow-500'
                            : node.type === 'parallel'
                              ? 'bg-purple-500'
                              : node.type === 'loop'
                                ? 'bg-green-500'
                                : 'bg-orange-500'
                      }`}
                    />
                    <div>
                      <span className="font-medium text-gray-900">
                        {node.data.label || node.type}
                      </span>
                      <span className="text-xs text-gray-500 ml-2">
                        ({node.type})
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              <h3 className="text-sm font-medium text-gray-700 mt-4 mb-3">
                Connections ({previewTemplate.edges.length})
              </h3>
              <div className="text-sm text-gray-600">
                {previewTemplate.edges.map((edge) => (
                  <div key={edge.id} className="flex items-center gap-2 py-1">
                    <span className="font-mono text-xs">{edge.source}</span>
                    <svg className="w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                    </svg>
                    <span className="font-mono text-xs">{edge.target}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 border-t border-gray-200 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPreviewTemplate(null)}>
                Close
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  handleUseTemplate(previewTemplate);
                }}
              >
                Use This Template
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
