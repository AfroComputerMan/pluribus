/**
 * useKeyboardShortcuts Hook Tests
 * Tests for keyboard shortcuts in workflow builder
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

describe('useKeyboardShortcuts', () => {
  const mockHandlers = {
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onDeselect: vi.fn(),
    onDuplicate: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    // Clean up event listeners
  });

  describe('Ctrl+S - Save', () => {
    it('calls onSave when Ctrl+S is pressed', () => {
      renderHook(() => useKeyboardShortcuts(mockHandlers));

      const event = new KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);

      expect(mockHandlers.onSave).toHaveBeenCalledTimes(1);
    });

    it('calls onSave when Cmd+S is pressed (Mac)', () => {
      renderHook(() => useKeyboardShortcuts(mockHandlers));

      const event = new KeyboardEvent('keydown', {
        key: 's',
        metaKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);

      expect(mockHandlers.onSave).toHaveBeenCalledTimes(1);
    });

    it('prevents default browser save dialog', () => {
      renderHook(() => useKeyboardShortcuts(mockHandlers));

      const event = new KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true,
        bubbles: true,
      });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      document.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });
  });

  describe('Delete/Backspace - Delete node', () => {
    it('calls onDelete when Delete key is pressed', () => {
      renderHook(() => useKeyboardShortcuts(mockHandlers));

      const event = new KeyboardEvent('keydown', {
        key: 'Delete',
        bubbles: true,
      });
      document.dispatchEvent(event);

      expect(mockHandlers.onDelete).toHaveBeenCalledTimes(1);
    });

    it('calls onDelete when Backspace key is pressed', () => {
      renderHook(() => useKeyboardShortcuts(mockHandlers));

      const event = new KeyboardEvent('keydown', {
        key: 'Backspace',
        bubbles: true,
      });
      document.dispatchEvent(event);

      expect(mockHandlers.onDelete).toHaveBeenCalledTimes(1);
    });

    it('does not call onDelete when typing in an input', () => {
      renderHook(() => useKeyboardShortcuts(mockHandlers));

      // Create an input element and focus it
      const input = document.createElement('input');
      document.body.appendChild(input);
      input.focus();

      const event = new KeyboardEvent('keydown', {
        key: 'Delete',
        bubbles: true,
      });
      Object.defineProperty(event, 'target', { value: input });
      document.dispatchEvent(event);

      expect(mockHandlers.onDelete).not.toHaveBeenCalled();

      // Cleanup
      document.body.removeChild(input);
    });
  });

  describe('Ctrl+Z - Undo', () => {
    it('calls onUndo when Ctrl+Z is pressed', () => {
      renderHook(() => useKeyboardShortcuts(mockHandlers));

      const event = new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);

      expect(mockHandlers.onUndo).toHaveBeenCalledTimes(1);
    });

    it('calls onUndo when Cmd+Z is pressed (Mac)', () => {
      renderHook(() => useKeyboardShortcuts(mockHandlers));

      const event = new KeyboardEvent('keydown', {
        key: 'z',
        metaKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);

      expect(mockHandlers.onUndo).toHaveBeenCalledTimes(1);
    });
  });

  describe('Ctrl+Shift+Z / Ctrl+Y - Redo', () => {
    it('calls onRedo when Ctrl+Shift+Z is pressed', () => {
      renderHook(() => useKeyboardShortcuts(mockHandlers));

      const event = new KeyboardEvent('keydown', {
        key: 'z',
        ctrlKey: true,
        shiftKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);

      expect(mockHandlers.onRedo).toHaveBeenCalledTimes(1);
    });

    it('calls onRedo when Cmd+Shift+Z is pressed (Mac)', () => {
      renderHook(() => useKeyboardShortcuts(mockHandlers));

      const event = new KeyboardEvent('keydown', {
        key: 'z',
        metaKey: true,
        shiftKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);

      expect(mockHandlers.onRedo).toHaveBeenCalledTimes(1);
    });

    it('calls onRedo when Ctrl+Y is pressed', () => {
      renderHook(() => useKeyboardShortcuts(mockHandlers));

      const event = new KeyboardEvent('keydown', {
        key: 'y',
        ctrlKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);

      expect(mockHandlers.onRedo).toHaveBeenCalledTimes(1);
    });
  });

  describe('Escape - Deselect', () => {
    it('calls onDeselect when Escape is pressed', () => {
      renderHook(() => useKeyboardShortcuts(mockHandlers));

      const event = new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
      });
      document.dispatchEvent(event);

      expect(mockHandlers.onDeselect).toHaveBeenCalledTimes(1);
    });
  });

  describe('Ctrl+D - Duplicate', () => {
    it('calls onDuplicate when Ctrl+D is pressed', () => {
      renderHook(() => useKeyboardShortcuts(mockHandlers));

      const event = new KeyboardEvent('keydown', {
        key: 'd',
        ctrlKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);

      expect(mockHandlers.onDuplicate).toHaveBeenCalledTimes(1);
    });

    it('calls onDuplicate when Cmd+D is pressed (Mac)', () => {
      renderHook(() => useKeyboardShortcuts(mockHandlers));

      const event = new KeyboardEvent('keydown', {
        key: 'd',
        metaKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);

      expect(mockHandlers.onDuplicate).toHaveBeenCalledTimes(1);
    });

    it('prevents default bookmark action', () => {
      renderHook(() => useKeyboardShortcuts(mockHandlers));

      const event = new KeyboardEvent('keydown', {
        key: 'd',
        ctrlKey: true,
        bubbles: true,
      });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      document.dispatchEvent(event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });
  });

  describe('disabled state', () => {
    it('does not trigger shortcuts when disabled', () => {
      renderHook(() => useKeyboardShortcuts({ ...mockHandlers, disabled: true }));

      const event = new KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true,
        bubbles: true,
      });
      document.dispatchEvent(event);

      expect(mockHandlers.onSave).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('removes event listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
      const { unmount } = renderHook(() => useKeyboardShortcuts(mockHandlers));

      unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
    });
  });

  describe('optional handlers', () => {
    it('works with only some handlers provided', () => {
      const partialHandlers = {
        onSave: vi.fn(),
      };

      renderHook(() => useKeyboardShortcuts(partialHandlers));

      const saveEvent = new KeyboardEvent('keydown', {
        key: 's',
        ctrlKey: true,
        bubbles: true,
      });
      document.dispatchEvent(saveEvent);

      expect(partialHandlers.onSave).toHaveBeenCalledTimes(1);

      // Other shortcuts should not throw
      const deleteEvent = new KeyboardEvent('keydown', {
        key: 'Delete',
        bubbles: true,
      });
      expect(() => document.dispatchEvent(deleteEvent)).not.toThrow();
    });
  });
});
