import { type KeyboardEvent, useCallback } from 'react';

// Spread onKeyDown on a scroll container; rows need tabIndex={0} + data-nav-item. data-nav-delete marks a row's delete control, fired by Delete (not Backspace - too easy to hit by accident).
export function useListKeyboardNav(): {
  onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
} {
  const onKeyDown = useCallback((e: KeyboardEvent<HTMLElement>) => {
    const container = e.currentTarget;
    const items = Array.from(container.querySelectorAll<HTMLElement>('[data-nav-item]')).filter(
      (el) => el.offsetParent !== null,
    );
    if (items.length === 0) return;

    const active = document.activeElement as HTMLElement | null;
    // Exact match for activation; containing row for arrow nav (focus may be on a row's button).
    const idx = active ? items.indexOf(active) : -1;
    const row = active?.closest<HTMLElement>('[data-nav-item]') ?? null;
    const navIdx = row ? items.indexOf(row) : -1;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        items[navIdx < 0 ? 0 : Math.min(items.length - 1, navIdx + 1)].focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        items[navIdx < 0 ? items.length - 1 : Math.max(0, navIdx - 1)].focus();
        break;
      case 'Home':
        e.preventDefault();
        items[0].focus();
        break;
      case 'End':
        e.preventDefault();
        items[items.length - 1].focus();
        break;
      case 'Enter':
        if (idx >= 0) {
          e.preventDefault();
          items[idx].click();
        }
        break;
      case 'Delete': {
        if (idx < 0) break;
        const del = items[idx].querySelector<HTMLElement>('[data-nav-delete]');
        if (del) {
          e.preventDefault();
          del.click();
        }
        break;
      }
      default:
        break;
    }
  }, []);

  return { onKeyDown };
}

// Activates a focusable row (role="button") on Enter/Space by triggering its onClick and stops
// propagation so an enclosing useListKeyboardNav container does not also fire Enter (double activation).
export function rowActivateKeyDown(e: KeyboardEvent<HTMLElement>) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.click();
  }
}
