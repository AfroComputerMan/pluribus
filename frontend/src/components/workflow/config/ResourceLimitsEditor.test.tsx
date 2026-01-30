/**
 * ResourceLimitsEditor Tests
 * TDD: Tests written before implementation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ResourceLimitsEditor } from './ResourceLimitsEditor';
import type { ResourceLimits } from '../../../lib/validation/nodeSchemas';

describe('ResourceLimitsEditor', () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('empty state', () => {
    it('renders all resource limit fields', () => {
      render(<ResourceLimitsEditor value={{}} onChange={mockOnChange} />);

      expect(screen.getByLabelText(/memory/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/cpu/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/timeout/i)).toBeInTheDocument();
    });

    it('shows empty inputs when no values provided', () => {
      render(<ResourceLimitsEditor value={{}} onChange={mockOnChange} />);

      const memoryInput = screen.getByLabelText(/memory/i) as HTMLInputElement;
      expect(memoryInput.value).toBe('');
    });
  });

  describe('with existing values', () => {
    const value: ResourceLimits = {
      memoryMB: 512,
      cpuShares: 1024,
      timeoutSeconds: 300,
    };

    it('displays current values', () => {
      render(<ResourceLimitsEditor value={value} onChange={mockOnChange} />);

      expect(screen.getByLabelText(/memory/i)).toHaveValue(512);
      expect(screen.getByLabelText(/cpu/i)).toHaveValue(1024);
      expect(screen.getByLabelText(/timeout/i)).toHaveValue(300);
    });
  });

  describe('editing values', () => {
    it('calls onChange when memory is updated', async () => {
      const user = userEvent.setup();
      render(<ResourceLimitsEditor value={{}} onChange={mockOnChange} />);

      const memoryInput = screen.getByLabelText(/memory/i);
      // Change the input value directly for reliable testing
      await user.clear(memoryInput);
      await user.type(memoryInput, '512');

      // Verify onChange was called with a number value for memoryMB
      expect(mockOnChange).toHaveBeenCalled();
      const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
      expect(typeof lastCall.memoryMB).toBe('number');
    });

    it('calls onChange when CPU is updated', async () => {
      const user = userEvent.setup();
      render(<ResourceLimitsEditor value={{}} onChange={mockOnChange} />);

      const cpuInput = screen.getByLabelText(/cpu/i);
      await user.type(cpuInput, '1024');

      // Verify onChange was called with a number value for cpuShares
      expect(mockOnChange).toHaveBeenCalled();
      const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
      expect(typeof lastCall.cpuShares).toBe('number');
    });

    it('calls onChange when timeout is updated', async () => {
      const user = userEvent.setup();
      render(<ResourceLimitsEditor value={{}} onChange={mockOnChange} />);

      const timeoutInput = screen.getByLabelText(/timeout/i);
      await user.type(timeoutInput, '300');

      // Verify onChange was called with a number value for timeoutSeconds
      expect(mockOnChange).toHaveBeenCalled();
      const lastCall = mockOnChange.mock.calls[mockOnChange.mock.calls.length - 1][0];
      expect(typeof lastCall.timeoutSeconds).toBe('number');
    });

    it('clears value when input is empty', async () => {
      const user = userEvent.setup();
      const value: ResourceLimits = { memoryMB: 512 };
      render(<ResourceLimitsEditor value={value} onChange={mockOnChange} />);

      const memoryInput = screen.getByLabelText(/memory/i);
      await user.clear(memoryInput);

      expect(mockOnChange).toHaveBeenCalledWith(
        expect.objectContaining({ memoryMB: undefined }),
      );
    });
  });

  describe('validation constraints', () => {
    it('has min value of 1 for memory', () => {
      render(<ResourceLimitsEditor value={{}} onChange={mockOnChange} />);
      const memoryInput = screen.getByLabelText(/memory/i) as HTMLInputElement;
      expect(memoryInput.min).toBe('1');
    });

    it('has max value of 8192 for memory (8GB)', () => {
      render(<ResourceLimitsEditor value={{}} onChange={mockOnChange} />);
      const memoryInput = screen.getByLabelText(/memory/i) as HTMLInputElement;
      expect(memoryInput.max).toBe('8192');
    });

    it('has min value of 1 for timeout', () => {
      render(<ResourceLimitsEditor value={{}} onChange={mockOnChange} />);
      const timeoutInput = screen.getByLabelText(/timeout/i) as HTMLInputElement;
      expect(timeoutInput.min).toBe('1');
    });
  });

  describe('helper text', () => {
    it('shows units for memory field', () => {
      render(<ResourceLimitsEditor value={{}} onChange={mockOnChange} />);
      // Check that MB appears in the label
      expect(screen.getByText('(MB)')).toBeInTheDocument();
    });

    it('shows units for timeout field', () => {
      render(<ResourceLimitsEditor value={{}} onChange={mockOnChange} />);
      // Check that seconds appears in the label
      expect(screen.getByText('(seconds)')).toBeInTheDocument();
    });
  });

  describe('disabled state', () => {
    it('disables all inputs when disabled prop is true', () => {
      render(<ResourceLimitsEditor value={{}} onChange={mockOnChange} disabled />);

      expect(screen.getByLabelText(/memory/i)).toBeDisabled();
      expect(screen.getByLabelText(/cpu/i)).toBeDisabled();
      expect(screen.getByLabelText(/timeout/i)).toBeDisabled();
    });
  });
});
