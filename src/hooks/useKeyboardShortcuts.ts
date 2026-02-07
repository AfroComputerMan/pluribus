import { useEffect } from 'react';

interface KeyboardShortcutCallbacks {
  onNewSession?: () => void;
  onCloseSession?: () => void;
  onCancel?: () => void;
}

export function useKeyboardShortcuts(callbacks: KeyboardShortcutCallbacks) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key === 'n') {
        e.preventDefault();
        callbacks.onNewSession?.();
      } else if (mod && e.key === 'w') {
        e.preventDefault();
        callbacks.onCloseSession?.();
      } else if (e.key === 'Escape') {
        callbacks.onCancel?.();
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [callbacks.onNewSession, callbacks.onCloseSession, callbacks.onCancel]);
}
