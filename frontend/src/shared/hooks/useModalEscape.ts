import { useEffect } from 'react';

// Only the topmost (last-mounted) overlay closes on Escape: stopPropagation can't stop sibling window
// listeners, so without this stack one Escape would close every open overlay.
const escapeStack: Array<() => void> = [];

export function useModalEscape(onClose: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const handler = () => onClose();
    escapeStack.push(handler);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (escapeStack[escapeStack.length - 1] !== handler) return; // only the topmost overlay closes
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      const idx = escapeStack.lastIndexOf(handler);
      if (idx !== -1) escapeStack.splice(idx, 1);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose, enabled]);
}
