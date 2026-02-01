/**
 * InputMappingEditor Tests
 * TDD: Tests written before implementation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InputMappingEditor } from './InputMappingEditor';
import type { WorkflowNode } from '../../../stores/workflowBuilderStore';

describe('InputMappingEditor', () => {
  const mockOnChange = vi.fn();
  const mockNodes: WorkflowNode[] = [
    {
      id: 'agent_1',
      type: 'agent',
      position: { x: 0, y: 0 },
      data: { label: 'Code Writer' },
    },
    {
      id: 'agent_2',
      type: 'agent',
      position: { x: 100, y: 0 },
      data: { label: 'Code Reviewer' },
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('empty state', () => {
    it('renders add mapping button', () => {
      render(
        <InputMappingEditor
          value={{}}
          onChange={mockOnChange}
          availableNodes={mockNodes}
        />,
      );
      expect(screen.getByRole('button', { name: /add input/i })).toBeInTheDocument();
    });

    it('shows empty state message when no mappings', () => {
      render(
        <InputMappingEditor
          value={{}}
          onChange={mockOnChange}
          availableNodes={mockNodes}
        />,
      );
      expect(screen.getByText(/no input mappings/i)).toBeInTheDocument();
    });
  });

  describe('with static string mappings', () => {
    const value = {
      prompt: 'Write code for this task',
      context: 'Some context here',
    };

    it('displays existing mappings', () => {
      render(
        <InputMappingEditor
          value={value}
          onChange={mockOnChange}
          availableNodes={mockNodes}
        />,
      );
      expect(screen.getByDisplayValue('prompt')).toBeInTheDocument();
      expect(screen.getByDisplayValue('Write code for this task')).toBeInTheDocument();
    });

    it('can edit mapping key', async () => {
      const user = userEvent.setup();
      render(
        <InputMappingEditor
          value={value}
          onChange={mockOnChange}
          availableNodes={mockNodes}
        />,
      );

      const keyInput = screen.getByDisplayValue('prompt');
      await user.clear(keyInput);
      await user.type(keyInput, 'newKey');
      // Key change happens on blur
      await user.tab();

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({
          newKey: 'Write code for this task',
        }),
      );
    });

    it('can edit mapping value', async () => {
      const user = userEvent.setup();
      render(
        <InputMappingEditor
          value={value}
          onChange={mockOnChange}
          availableNodes={mockNodes}
        />,
      );

      const valueInput = screen.getByDisplayValue('Write code for this task');
      await user.clear(valueInput);
      await user.type(valueInput, 'New value');

      expect(mockOnChange).toHaveBeenCalled();
    });

    it('can remove a mapping', async () => {
      const user = userEvent.setup();
      render(
        <InputMappingEditor
          value={value}
          onChange={mockOnChange}
          availableNodes={mockNodes}
        />,
      );

      const removeButtons = screen.getAllByRole('button', { name: /remove/i });
      await user.click(removeButtons[0]);

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.not.objectContaining({ prompt: expect.anything() }),
      );
    });
  });

  describe('with node reference mappings', () => {
    const value = {
      input: { fromNode: 'agent_1', path: 'output.result' },
    };

    it('displays node reference mappings', () => {
      render(
        <InputMappingEditor
          value={value}
          onChange={mockOnChange}
          availableNodes={mockNodes}
        />,
      );
      expect(screen.getByDisplayValue('input')).toBeInTheDocument();
      // Should show the node selector and path input
      expect(screen.getByDisplayValue('output.result')).toBeInTheDocument();
    });

    it('shows available nodes in dropdown', async () => {
      render(
        <InputMappingEditor
          value={value}
          onChange={mockOnChange}
          availableNodes={mockNodes}
        />,
      );

      // Find the node selector
      const nodeSelect = screen.getByRole('combobox');
      expect(nodeSelect).toBeInTheDocument();

      // Check that options include the available nodes
      const options = screen.getAllByRole('option');
      expect(options.some((opt) => opt.textContent?.includes('Code Writer'))).toBe(true);
      expect(options.some((opt) => opt.textContent?.includes('Code Reviewer'))).toBe(true);
    });

    it('can change source node', async () => {
      const user = userEvent.setup();
      render(
        <InputMappingEditor
          value={value}
          onChange={mockOnChange}
          availableNodes={mockNodes}
        />,
      );

      const nodeSelect = screen.getByRole('combobox');
      await user.selectOptions(nodeSelect, 'agent_2');

      expect(mockOnChange).toHaveBeenCalledWith({
        input: { fromNode: 'agent_2', path: 'output.result' },
      });
    });
  });

  describe('adding new mappings', () => {
    it('adds a new static mapping when clicking add button', async () => {
      const user = userEvent.setup();
      render(
        <InputMappingEditor
          value={{}}
          onChange={mockOnChange}
          availableNodes={mockNodes}
        />,
      );

      await user.click(screen.getByRole('button', { name: /add input/i }));

      // Should call onChange with a new empty mapping
      expect(mockOnChange).toHaveBeenCalled();
    });
  });

  describe('toggle between static and reference', () => {
    it('can toggle from static to reference mode', async () => {
      const user = userEvent.setup();
      render(
        <InputMappingEditor
          value={{ prompt: 'static value' }}
          onChange={mockOnChange}
          availableNodes={mockNodes}
        />,
      );

      // Find and click the toggle to reference mode
      const toggleButton = screen.getByRole('button', { name: /reference/i });
      await user.click(toggleButton);

      expect(mockOnChange).toHaveBeenCalledWith({
        prompt: { fromNode: '', path: '' },
      });
    });
  });
});
