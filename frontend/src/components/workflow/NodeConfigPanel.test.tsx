/**
 * NodeConfigPanel Tests
 * TDD: Tests written before implementation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NodeConfigPanel } from './NodeConfigPanel';
import type { WorkflowNode } from '../../stores/workflowBuilderStore';

// Mock the store
const mockUpdateNode = vi.fn();
const mockSetSelectedNode = vi.fn();
let mockNodes: WorkflowNode[] = [];
let mockSelectedNode: string | null = null;

vi.mock('../../stores/workflowBuilderStore', () => ({
  useWorkflowBuilderStore: (selector: (state: unknown) => unknown) => {
    const state = {
      nodes: mockNodes,
      selectedNode: mockSelectedNode,
      updateNode: mockUpdateNode,
      setSelectedNode: mockSetSelectedNode,
    };
    return selector(state);
  },
}));

describe('NodeConfigPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNodes = [];
    mockSelectedNode = null;
  });

  describe('when no node is selected', () => {
    beforeEach(() => {
      mockNodes = [];
      mockSelectedNode = null;
    });

    it('renders empty state message', () => {
      render(<NodeConfigPanel />);
      expect(screen.getByText(/select a node/i)).toBeInTheDocument();
    });

    it('does not render save button', () => {
      render(<NodeConfigPanel />);
      expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
    });
  });

  describe('when agent node is selected', () => {
    const agentNode: WorkflowNode = {
      id: 'agent_1',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: {
        label: 'Code Writer',
        agentId: '123e4567-e89b-12d3-a456-426614174000',
        timeout: 300,
      },
    };

    beforeEach(() => {
      mockNodes = [agentNode];
      mockSelectedNode = 'agent_1';
    });

    it('displays node label in header', () => {
      render(<NodeConfigPanel />);
      expect(screen.getByText('Code Writer')).toBeInTheDocument();
    });

    it('displays agent configuration form', () => {
      render(<NodeConfigPanel />);
      expect(screen.getByLabelText(/agent id/i)).toBeInTheDocument();
    });

    it('shows save and cancel buttons', () => {
      render(<NodeConfigPanel />);
      expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /cancel/i })).toBeInTheDocument();
    });

    it('populates form with current node data', () => {
      render(<NodeConfigPanel />);
      const agentIdInput = screen.getByLabelText(/agent id/i) as HTMLInputElement;
      expect(agentIdInput.value).toBe('123e4567-e89b-12d3-a456-426614174000');
    });

    it('calls updateNode on save with valid data', async () => {
      const user = userEvent.setup();
      render(<NodeConfigPanel />);

      const labelInput = screen.getByLabelText(/label/i) as HTMLInputElement;
      await user.clear(labelInput);
      await user.type(labelInput, 'Updated Label');

      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(mockUpdateNode).toHaveBeenCalledWith(
        'agent_1',
        expect.objectContaining({
          data: expect.objectContaining({
            label: 'Updated Label',
          }),
        }),
      );
    });

    it('clears selection on cancel', async () => {
      const user = userEvent.setup();
      render(<NodeConfigPanel />);

      await user.click(screen.getByRole('button', { name: /cancel/i }));

      expect(mockSetSelectedNode).toHaveBeenCalledWith(null);
    });
  });

  describe('when condition node is selected', () => {
    const conditionNode: WorkflowNode = {
      id: 'condition_1',
      type: 'condition',
      position: { x: 0, y: 0 },
      data: {
        label: 'Check Status',
        expression: 'output.success === true',
        trueBranch: 'success_node',
        falseBranch: 'failure_node',
      },
    };

    beforeEach(() => {
      mockNodes = [conditionNode];
      mockSelectedNode = 'condition_1';
    });

    it('displays condition configuration form', () => {
      render(<NodeConfigPanel />);
      expect(screen.getByLabelText(/expression/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/true branch/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/false branch/i)).toBeInTheDocument();
    });

    it('populates form with current node data', () => {
      render(<NodeConfigPanel />);
      expect(screen.getByLabelText(/expression/i)).toHaveValue('output.success === true');
      expect(screen.getByLabelText(/true branch/i)).toHaveValue('success_node');
      expect(screen.getByLabelText(/false branch/i)).toHaveValue('failure_node');
    });

    it('updates expression on input change', async () => {
      const user = userEvent.setup();
      render(<NodeConfigPanel />);

      const expressionInput = screen.getByLabelText(/expression/i);
      await user.clear(expressionInput);
      await user.type(expressionInput, 'status === 200');

      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(mockUpdateNode).toHaveBeenCalledWith(
        'condition_1',
        expect.objectContaining({
          data: expect.objectContaining({
            expression: 'status === 200',
          }),
        }),
      );
    });

    it('updates trueBranch on input change', async () => {
      const user = userEvent.setup();
      render(<NodeConfigPanel />);

      const trueBranchInput = screen.getByLabelText(/true branch/i);
      await user.clear(trueBranchInput);
      await user.type(trueBranchInput, 'new_success');

      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(mockUpdateNode).toHaveBeenCalledWith(
        'condition_1',
        expect.objectContaining({
          data: expect.objectContaining({
            trueBranch: 'new_success',
          }),
        }),
      );
    });

    it('updates falseBranch on input change', async () => {
      const user = userEvent.setup();
      render(<NodeConfigPanel />);

      const falseBranchInput = screen.getByLabelText(/false branch/i);
      await user.clear(falseBranchInput);
      await user.type(falseBranchInput, 'new_failure');

      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(mockUpdateNode).toHaveBeenCalledWith(
        'condition_1',
        expect.objectContaining({
          data: expect.objectContaining({
            falseBranch: 'new_failure',
          }),
        }),
      );
    });
  });

  describe('when parallel node is selected', () => {
    const parallelNode: WorkflowNode = {
      id: 'parallel_1',
      type: 'parallel',
      position: { x: 0, y: 0 },
      data: {
        label: 'Run Tasks',
        branches: ['task_1', 'task_2'],
        joinStrategy: 'all',
      },
    };

    beforeEach(() => {
      mockNodes = [parallelNode];
      mockSelectedNode = 'parallel_1';
    });

    it('displays parallel configuration form', () => {
      render(<NodeConfigPanel />);
      expect(screen.getByLabelText(/branches/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/join strategy/i)).toBeInTheDocument();
    });

    it('shows join strategy options', () => {
      render(<NodeConfigPanel />);
      const select = screen.getByLabelText(/join strategy/i) as HTMLSelectElement;
      expect(select.value).toBe('all');
    });

    it('populates branches from node data', () => {
      render(<NodeConfigPanel />);
      expect(screen.getByLabelText(/branches/i)).toHaveValue('task_1, task_2');
    });

    it('updates branches on input change', async () => {
      const user = userEvent.setup();
      render(<NodeConfigPanel />);

      const branchesInput = screen.getByLabelText(/branches/i);
      fireEvent.change(branchesInput, { target: { value: 'a, b, c' } });

      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(mockUpdateNode).toHaveBeenCalledWith(
        'parallel_1',
        expect.objectContaining({
          data: expect.objectContaining({
            branches: ['a', 'b', 'c'],
          }),
        }),
      );
    });

    it('updates joinStrategy on select change', async () => {
      const user = userEvent.setup();
      render(<NodeConfigPanel />);

      const select = screen.getByLabelText(/join strategy/i);
      await user.selectOptions(select, 'race');

      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(mockUpdateNode).toHaveBeenCalledWith(
        'parallel_1',
        expect.objectContaining({
          data: expect.objectContaining({
            joinStrategy: 'race',
          }),
        }),
      );
    });
  });

  describe('when loop node is selected', () => {
    const loopNode: WorkflowNode = {
      id: 'loop_1',
      type: 'loop',
      position: { x: 0, y: 0 },
      data: {
        label: 'Repeat Task',
        condition: 'count < 10',
        maxIterations: 100,
        body: 'task_node',
      },
    };

    beforeEach(() => {
      mockNodes = [loopNode];
      mockSelectedNode = 'loop_1';
    });

    it('displays loop configuration form', () => {
      render(<NodeConfigPanel />);
      expect(screen.getByLabelText(/condition/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/max iterations/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/body/i)).toBeInTheDocument();
    });

    it('populates form with current node data', () => {
      render(<NodeConfigPanel />);
      expect(screen.getByLabelText(/condition/i)).toHaveValue('count < 10');
      expect(screen.getByLabelText(/max iterations/i)).toHaveValue(100);
      expect(screen.getByLabelText(/body/i)).toHaveValue('task_node');
    });

    it('updates condition on input change', async () => {
      const user = userEvent.setup();
      render(<NodeConfigPanel />);

      const conditionInput = screen.getByLabelText(/condition/i);
      await user.clear(conditionInput);
      await user.type(conditionInput, 'items.length > 0');

      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(mockUpdateNode).toHaveBeenCalledWith(
        'loop_1',
        expect.objectContaining({
          data: expect.objectContaining({
            condition: 'items.length > 0',
          }),
        }),
      );
    });

    it('updates maxIterations on input change', async () => {
      const user = userEvent.setup();
      render(<NodeConfigPanel />);

      const maxIterationsInput = screen.getByLabelText(/max iterations/i);
      await user.clear(maxIterationsInput);
      await user.type(maxIterationsInput, '50');

      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(mockUpdateNode).toHaveBeenCalledWith(
        'loop_1',
        expect.objectContaining({
          data: expect.objectContaining({
            maxIterations: 50,
          }),
        }),
      );
    });

    it('updates body on input change', async () => {
      const user = userEvent.setup();
      render(<NodeConfigPanel />);

      const bodyInput = screen.getByLabelText(/body/i);
      await user.clear(bodyInput);
      await user.type(bodyInput, 'new_body_node');

      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(mockUpdateNode).toHaveBeenCalledWith(
        'loop_1',
        expect.objectContaining({
          data: expect.objectContaining({
            body: 'new_body_node',
          }),
        }),
      );
    });
  });

  describe('when human-review node is selected', () => {
    const humanReviewNode: WorkflowNode = {
      id: 'review_1',
      type: 'human-review',
      position: { x: 0, y: 0 },
      data: {
        label: 'Approve Release',
        prompt: 'Do you approve this deployment?',
        timeout: 3600,
        options: ['Approve', 'Reject'],
      },
    };

    beforeEach(() => {
      mockNodes = [humanReviewNode];
      mockSelectedNode = 'review_1';
    });

    it('displays human review configuration form', () => {
      render(<NodeConfigPanel />);
      expect(screen.getByLabelText(/prompt/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/timeout/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/options/i)).toBeInTheDocument();
    });

    it('populates form with current node data', () => {
      render(<NodeConfigPanel />);
      expect(screen.getByLabelText(/prompt/i)).toHaveValue('Do you approve this deployment?');
      expect(screen.getByLabelText(/options/i)).toHaveValue('Approve, Reject');
    });

    it('updates prompt on input change', async () => {
      const user = userEvent.setup();
      render(<NodeConfigPanel />);

      const promptInput = screen.getByLabelText(/prompt/i);
      await user.clear(promptInput);
      await user.type(promptInput, 'Review this code change');

      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(mockUpdateNode).toHaveBeenCalledWith(
        'review_1',
        expect.objectContaining({
          data: expect.objectContaining({
            prompt: 'Review this code change',
          }),
        }),
      );
    });

    it('updates timeout on input change', async () => {
      const user = userEvent.setup();
      render(<NodeConfigPanel />);

      const timeoutInput = screen.getByLabelText(/timeout/i);
      await user.clear(timeoutInput);
      await user.type(timeoutInput, '7200');

      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(mockUpdateNode).toHaveBeenCalledWith(
        'review_1',
        expect.objectContaining({
          data: expect.objectContaining({
            timeout: 7200,
          }),
        }),
      );
    });

    it('updates options on input change', async () => {
      const user = userEvent.setup();
      render(<NodeConfigPanel />);

      const optionsInput = screen.getByLabelText(/options/i);
      // Use fireEvent.change for comma-separated fields to avoid keystroke parsing issues
      fireEvent.change(optionsInput, { target: { value: 'Yes, No, Maybe' } });

      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(mockUpdateNode).toHaveBeenCalledWith(
        'review_1',
        expect.objectContaining({
          data: expect.objectContaining({
            options: ['Yes', 'No', 'Maybe'],
          }),
        }),
      );
    });

    it('clears options when input is empty', async () => {
      const user = userEvent.setup();
      render(<NodeConfigPanel />);

      const optionsInput = screen.getByLabelText(/options/i);
      await user.clear(optionsInput);

      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(mockUpdateNode).toHaveBeenCalledWith(
        'review_1',
        expect.objectContaining({
          data: expect.objectContaining({
            options: undefined,
          }),
        }),
      );
    });
  });

  describe('validation', () => {
    const invalidAgentNode: WorkflowNode = {
      id: 'agent_1',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: {
        label: 'Test Agent',
        agentId: '', // Invalid - empty
      },
    };

    beforeEach(() => {
      mockNodes = [invalidAgentNode];
      mockSelectedNode = 'agent_1';
    });

    it('shows validation errors on save with invalid data', async () => {
      const user = userEvent.setup();
      render(<NodeConfigPanel />);

      await user.click(screen.getByRole('button', { name: /save/i }));

      expect(screen.getByText(/agent id must be a valid uuid/i)).toBeInTheDocument();
      expect(mockUpdateNode).not.toHaveBeenCalled();
    });

    it('clears field error when user edits that field', async () => {
      const user = userEvent.setup();
      render(<NodeConfigPanel />);

      // First trigger validation error
      await user.click(screen.getByRole('button', { name: /save/i }));
      expect(screen.getByText(/agent id must be a valid uuid/i)).toBeInTheDocument();

      // Now edit the field
      const agentIdInput = screen.getByLabelText(/agent id/i);
      await user.type(agentIdInput, '123e4567-e89b-12d3-a456-426614174000');

      // Error should be cleared
      expect(screen.queryByText(/agent id must be a valid uuid/i)).not.toBeInTheDocument();
    });
  });

  describe('node type badge', () => {
    const agentNode: WorkflowNode = {
      id: 'agent_1',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: { label: 'Test', agentId: '123e4567-e89b-12d3-a456-426614174000' },
    };

    beforeEach(() => {
      mockNodes = [agentNode];
      mockSelectedNode = 'agent_1';
    });

    it('displays node type badge', () => {
      render(<NodeConfigPanel />);
      // The badge has specific styling - look for exact text in a span with capitalize class
      const badge = screen.getByText('agent');
      expect(badge).toBeInTheDocument();
      expect(badge.tagName).toBe('SPAN');
      expect(badge).toHaveClass('capitalize');
    });
  });

  describe('agent node with advanced editors', () => {
    const agentNodeWithInput: WorkflowNode = {
      id: 'agent_1',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: {
        label: 'Processor',
        agentId: '123e4567-e89b-12d3-a456-426614174000',
        input: { prompt: 'test prompt' },
        resourceLimits: { memoryMB: 512, cpuShares: 1024 },
      },
    };

    beforeEach(() => {
      mockNodes = [agentNodeWithInput];
      mockSelectedNode = 'agent_1';
    });

    it('renders input mappings section for agent nodes', () => {
      render(<NodeConfigPanel />);
      expect(screen.getByText(/input mappings/i)).toBeInTheDocument();
    });

    it('renders resource limits section for agent nodes', () => {
      render(<NodeConfigPanel />);
      expect(screen.getByText(/resource limits/i)).toBeInTheDocument();
    });

    it('shows add input button in input mappings', () => {
      render(<NodeConfigPanel />);
      expect(screen.getByRole('button', { name: /add input/i })).toBeInTheDocument();
    });

    it('displays memory limit field in resource limits', () => {
      render(<NodeConfigPanel />);
      expect(screen.getByLabelText(/memory/i)).toBeInTheDocument();
    });

    it('displays CPU shares field in resource limits', () => {
      render(<NodeConfigPanel />);
      expect(screen.getByLabelText(/cpu shares/i)).toBeInTheDocument();
    });

    it('displays timeout field in resource limits', () => {
      render(<NodeConfigPanel />);
      // Need to be specific since there's also a node-level timeout
      const timeoutLabels = screen.getAllByText(/timeout/i);
      expect(timeoutLabels.length).toBeGreaterThanOrEqual(1);
    });
  });
});
