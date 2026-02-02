/**
 * useKeyboardShortcuts Hook
 * Provides keyboard shortcuts for the workflow builder
 *
 * Shortcuts:
 * - Ctrl/Cmd+S: Save workflow
 * - Delete/Backspace: Delete selected node
 * - Ctrl/Cmd+Z: Undo
 * - Ctrl/Cmd+Shift+Z or Ctrl+Y: Redo
 * - Escape: Deselect node
 * - Ctrl/Cmd+D: Duplicate selected node
 */

import { useEffect, useCallback } from 'react';

export interface KeyboardShortcutHandlers {
  onSave?: () => void;
  onDelete?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onDeselect?: () => void;
  onDuplicate?: () => void;
  disabled?: boolean;
}

/**
 * Check if event target is an editable element (input, textarea, contenteditable)
 */
function isEditableElement(target: EventTarget | null): boolean {
  if (!target) return false;

  const element = target as HTMLElement;
  const tagName = element.tagName?.toLowerCase();

  // Check for input, textarea, or contentEditable elements
  if (tagName === 'input' || tagName === 'textarea') {
    return true;
  }

  if (element.isContentEditable) {
    return true;
  }

  return false;
}

export function useKeyboardShortcuts(handlers: KeyboardShortcutHandlers): void {
  const {
    onSave,
    onDelete,
    onUndo,
    onRedo,
    onDeselect,
    onDuplicate,
    disabled = false,
  } = handlers;

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      // Don't handle if disabled
      if (disabled) return;

      const { key, ctrlKey, metaKey, shiftKey } = event;
      const modifierKey = ctrlKey || metaKey;

      // Ctrl/Cmd+S - Save
      if (modifierKey && key.toLowerCase() === 's') {
        event.preventDefault();
        onSave?.();
        return;
      }

      // Ctrl/Cmd+Z - Undo (without shift)
      if (modifierKey && key.toLowerCase() === 'z' && !shiftKey) {
        event.preventDefault();
        onUndo?.();
        return;
      }

      // Ctrl/Cmd+Shift+Z or Ctrl+Y - Redo
      if ((modifierKey && key.toLowerCase() === 'z' && shiftKey) || (ctrlKey && key.toLowerCase() === 'y')) {
        event.preventDefault();
        onRedo?.();
        return;
      }

      // Ctrl/Cmd+D - Duplicate
      if (modifierKey && key.toLowerCase() === 'd') {
        event.preventDefault();
        onDuplicate?.();
        return;
      }

      // Delete/Backspace - Delete node (only when not in editable element)
      if ((key === 'Delete' || key === 'Backspace') && !isEditableElement(event.target)) {
        event.preventDefault();
        onDelete?.();
        return;
      }

      // Escape - Deselect
      if (key === 'Escape') {
        event.preventDefault();
        onDeselect?.();
        return;
      }
    },
    [disabled, onSave, onDelete, onUndo, onRedo, onDeselect, onDuplicate],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);
}
