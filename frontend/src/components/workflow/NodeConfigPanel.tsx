/**
 * NodeConfigPanel
 * Displays configuration form for the selected workflow node
 */

import { useState, useMemo } from 'react';
import { useWorkflowBuilderStore, type WorkflowNodeData, type WorkflowNode } from '../../stores/workflowBuilderStore';
import {
  validateNodeConfig,
  type WorkflowNodeType,
  type InputMapping,
  type ResourceLimits,
} from '../../lib/validation/nodeSchemas';
import { Button } from '../Button';
import { InputMappingEditor } from './config/InputMappingEditor';
import { ResourceLimitsEditor } from './config/ResourceLimitsEditor';

interface FormErrors {
  [field: string]: string;
}

/**
 * Wrapper component that handles empty state and provides key-based remount
 * when selection changes, avoiding setState-in-effect antipattern
 */
export function NodeConfigPanel() {
  const selectedNodeId = useWorkflowBuilderStore((state) => state.selectedNode);
  const nodes = useWorkflowBuilderStore((state) => state.nodes);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId],
  );

  // Empty state
  if (!selectedNode) {
    return (
      <div className="p-4 text-center text-gray-500">
        <p>Select a node to configure</p>
      </div>
    );
  }

  // Key prop ensures form remounts with fresh state when selection changes
  return <NodeConfigForm key={selectedNode.id} node={selectedNode} nodes={nodes} />;
}

interface NodeConfigFormProps {
  node: WorkflowNode;
  nodes: WorkflowNode[];
}

/**
 * Inner form component that initializes state from props on mount
 */
function NodeConfigForm({ node, nodes }: NodeConfigFormProps) {
  const updateNode = useWorkflowBuilderStore((state) => state.updateNode);
  const setSelectedNode = useWorkflowBuilderStore((state) => state.setSelectedNode);

  // Form state - initialized from node data (no useEffect needed due to key remount)
  const [formData, setFormData] = useState<WorkflowNodeData>(() => ({ ...node.data }));
  const [errors, setErrors] = useState<FormErrors>({});

  const nodeType = node.type as WorkflowNodeType;

  // Handle input changes
  const handleChange = (field: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    // Clear error for this field
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  // Handle save
  const handleSave = () => {
    const result = validateNodeConfig(nodeType, formData);

    if (!result.success) {
      const newErrors: FormErrors = {};
      for (const error of result.errors) {
        const field = error.path[0] || 'general';
        newErrors[field] = error.message;
      }
      setErrors(newErrors);
      return;
    }

    updateNode(node.id, { data: formData });
    setSelectedNode(null);
  };

  // Handle cancel
  const handleCancel = () => {
    setSelectedNode(null);
  };

  return (
    <div className="p-4 flex flex-col h-full">
      {/* Header */}
      <div className="mb-4 pb-4 border-b border-gray-200">
        <div className="flex items-center gap-2 mb-1">
          <span className="px-2 py-0.5 text-xs font-medium rounded bg-gray-100 text-gray-700 capitalize">
            {nodeType.replace('-', ' ')}
          </span>
        </div>
        <h3 className="text-lg font-semibold text-gray-900">
          {String(formData.label || 'Untitled Node')}
        </h3>
      </div>

      {/* Form */}
      <div className="flex-1 overflow-y-auto space-y-4">
        {/* Common label field */}
        <div>
          <label htmlFor="label" className="block text-sm font-medium text-gray-700 mb-1">
            Label
          </label>
          <input
            id="label"
            type="text"
            value={String(formData.label || '')}
            onChange={(e) => handleChange('label', e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Node label"
          />
        </div>

        {/* Type-specific fields */}
        {nodeType === 'agent' && (
          <AgentFields formData={formData} errors={errors} onChange={handleChange} availableNodes={nodes} />
        )}
        {nodeType === 'condition' && (
          <ConditionFields formData={formData} errors={errors} onChange={handleChange} />
        )}
        {nodeType === 'parallel' && (
          <ParallelFields formData={formData} errors={errors} onChange={handleChange} />
        )}
        {nodeType === 'loop' && (
          <LoopFields formData={formData} errors={errors} onChange={handleChange} />
        )}
        {nodeType === 'human-review' && (
          <HumanReviewFields formData={formData} errors={errors} onChange={handleChange} />
        )}
      </div>

      {/* Actions */}
      <div className="mt-4 pt-4 border-t border-gray-200 flex gap-2">
        <Button variant="secondary" onClick={handleCancel} className="flex-1">
          Cancel
        </Button>
        <Button variant="primary" onClick={handleSave} className="flex-1">
          Save
        </Button>
      </div>
    </div>
  );
}

// ============================================================================
// Field Components
// ============================================================================

interface FieldProps {
  formData: WorkflowNodeData;
  errors: FormErrors;
  onChange: (field: string, value: unknown) => void;
  availableNodes?: WorkflowNode[];
}

function AgentFields({ formData, errors, onChange, availableNodes = [] }: FieldProps) {
  const inputValue = (formData.input as InputMapping) || {};
  const resourceLimitsValue = (formData.resourceLimits as ResourceLimits) || {};

  return (
    <>
      <div>
        <label htmlFor="agentId" className="block text-sm font-medium text-gray-700 mb-1">
          Agent ID
        </label>
        <input
          id="agentId"
          type="text"
          value={String(formData.agentId || '')}
          onChange={(e) => onChange('agentId', e.target.value)}
          className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            errors.agentId ? 'border-red-500' : 'border-gray-300'
          }`}
          placeholder="UUID of the agent"
        />
        {errors.agentId && <p className="mt-1 text-sm text-red-600">{errors.agentId}</p>}
      </div>

      <div>
        <label htmlFor="timeout" className="block text-sm font-medium text-gray-700 mb-1">
          Timeout (seconds)
        </label>
        <input
          id="timeout"
          type="number"
          value={formData.timeout || ''}
          onChange={(e) => onChange('timeout', e.target.value ? Number(e.target.value) : undefined)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="300"
          min="1"
        />
        {errors.timeout && <p className="mt-1 text-sm text-red-600">{errors.timeout}</p>}
      </div>

      {/* Input Mappings */}
      <div className="pt-2 border-t border-gray-100">
        <InputMappingEditor
          value={inputValue}
          onChange={(value) => onChange('input', value)}
          availableNodes={availableNodes}
        />
        {errors.input && <p className="mt-1 text-sm text-red-600">{errors.input}</p>}
      </div>

      {/* Resource Limits */}
      <div className="pt-2 border-t border-gray-100">
        <ResourceLimitsEditor
          value={resourceLimitsValue}
          onChange={(value) => onChange('resourceLimits', value)}
        />
        {errors.resourceLimits && <p className="mt-1 text-sm text-red-600">{errors.resourceLimits}</p>}
      </div>
    </>
  );
}

function ConditionFields({ formData, errors, onChange }: FieldProps) {
  return (
    <>
      <div>
        <label htmlFor="expression" className="block text-sm font-medium text-gray-700 mb-1">
          Expression
        </label>
        <input
          id="expression"
          type="text"
          value={String(formData.expression || '')}
          onChange={(e) => onChange('expression', e.target.value)}
          className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            errors.expression ? 'border-red-500' : 'border-gray-300'
          }`}
          placeholder="output.success === true"
        />
        {errors.expression && <p className="mt-1 text-sm text-red-600">{errors.expression}</p>}
      </div>

      <div>
        <label htmlFor="trueBranch" className="block text-sm font-medium text-gray-700 mb-1">
          True Branch
        </label>
        <input
          id="trueBranch"
          type="text"
          value={String(formData.trueBranch || '')}
          onChange={(e) => onChange('trueBranch', e.target.value)}
          className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            errors.trueBranch ? 'border-red-500' : 'border-gray-300'
          }`}
          placeholder="Node ID for true condition"
        />
        {errors.trueBranch && <p className="mt-1 text-sm text-red-600">{errors.trueBranch}</p>}
      </div>

      <div>
        <label htmlFor="falseBranch" className="block text-sm font-medium text-gray-700 mb-1">
          False Branch
        </label>
        <input
          id="falseBranch"
          type="text"
          value={String(formData.falseBranch || '')}
          onChange={(e) => onChange('falseBranch', e.target.value)}
          className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            errors.falseBranch ? 'border-red-500' : 'border-gray-300'
          }`}
          placeholder="Node ID for false condition"
        />
        {errors.falseBranch && <p className="mt-1 text-sm text-red-600">{errors.falseBranch}</p>}
      </div>
    </>
  );
}

function ParallelFields({ formData, errors, onChange }: FieldProps) {
  const branches = Array.isArray(formData.branches) ? formData.branches : [];

  return (
    <>
      <div>
        <label htmlFor="branches" className="block text-sm font-medium text-gray-700 mb-1">
          Branches (comma-separated node IDs)
        </label>
        <input
          id="branches"
          type="text"
          value={branches.join(', ')}
          onChange={(e) => {
            const value = e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            onChange('branches', value);
          }}
          className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            errors.branches ? 'border-red-500' : 'border-gray-300'
          }`}
          placeholder="task_1, task_2, task_3"
        />
        {errors.branches && <p className="mt-1 text-sm text-red-600">{errors.branches}</p>}
      </div>

      <div>
        <label htmlFor="joinStrategy" className="block text-sm font-medium text-gray-700 mb-1">
          Join Strategy
        </label>
        <select
          id="joinStrategy"
          value={String(formData.joinStrategy || 'all')}
          onChange={(e) => onChange('joinStrategy', e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="all">All - Wait for all branches</option>
          <option value="any">Any - Continue when any completes</option>
          <option value="race">Race - First to complete wins</option>
        </select>
        {errors.joinStrategy && <p className="mt-1 text-sm text-red-600">{errors.joinStrategy}</p>}
      </div>
    </>
  );
}

function LoopFields({ formData, errors, onChange }: FieldProps) {
  return (
    <>
      <div>
        <label htmlFor="condition" className="block text-sm font-medium text-gray-700 mb-1">
          Condition
        </label>
        <input
          id="condition"
          type="text"
          value={String(formData.condition || '')}
          onChange={(e) => onChange('condition', e.target.value)}
          className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            errors.condition ? 'border-red-500' : 'border-gray-300'
          }`}
          placeholder="count < 10"
        />
        {errors.condition && <p className="mt-1 text-sm text-red-600">{errors.condition}</p>}
      </div>

      <div>
        <label htmlFor="maxIterations" className="block text-sm font-medium text-gray-700 mb-1">
          Max Iterations
        </label>
        <input
          id="maxIterations"
          type="number"
          value={formData.maxIterations || ''}
          onChange={(e) => onChange('maxIterations', e.target.value ? Number(e.target.value) : undefined)}
          className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            errors.maxIterations ? 'border-red-500' : 'border-gray-300'
          }`}
          placeholder="100"
          min="1"
          max="1000"
        />
        {errors.maxIterations && <p className="mt-1 text-sm text-red-600">{errors.maxIterations}</p>}
      </div>

      <div>
        <label htmlFor="body" className="block text-sm font-medium text-gray-700 mb-1">
          Body (Node ID)
        </label>
        <input
          id="body"
          type="text"
          value={String(formData.body || '')}
          onChange={(e) => onChange('body', e.target.value)}
          className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            errors.body ? 'border-red-500' : 'border-gray-300'
          }`}
          placeholder="Node ID to execute each iteration"
        />
        {errors.body && <p className="mt-1 text-sm text-red-600">{errors.body}</p>}
      </div>
    </>
  );
}

function HumanReviewFields({ formData, errors, onChange }: FieldProps) {
  return (
    <>
      <div>
        <label htmlFor="prompt" className="block text-sm font-medium text-gray-700 mb-1">
          Prompt
        </label>
        <textarea
          id="prompt"
          value={String(formData.prompt || '')}
          onChange={(e) => onChange('prompt', e.target.value)}
          rows={3}
          className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 ${
            errors.prompt ? 'border-red-500' : 'border-gray-300'
          }`}
          placeholder="Review prompt for the human reviewer"
        />
        {errors.prompt && <p className="mt-1 text-sm text-red-600">{errors.prompt}</p>}
      </div>

      <div>
        <label htmlFor="timeout" className="block text-sm font-medium text-gray-700 mb-1">
          Timeout (seconds)
        </label>
        <input
          id="timeout"
          type="number"
          value={formData.timeout || ''}
          onChange={(e) => onChange('timeout', e.target.value ? Number(e.target.value) : undefined)}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="3600"
          min="1"
        />
        {errors.timeout && <p className="mt-1 text-sm text-red-600">{errors.timeout}</p>}
      </div>

      <div>
        <label htmlFor="options" className="block text-sm font-medium text-gray-700 mb-1">
          Options (comma-separated)
        </label>
        <input
          id="options"
          type="text"
          value={Array.isArray(formData.options) ? formData.options.join(', ') : ''}
          onChange={(e) => {
            const value = e.target.value
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean);
            onChange('options', value.length > 0 ? value : undefined);
          }}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Approve, Reject, Request Changes"
        />
      </div>
    </>
  );
}
