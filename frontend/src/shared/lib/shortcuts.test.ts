import { describe, expect, it } from 'vitest';
import { bindingKey, matchesBinding } from '@/shared/lib/shortcuts';

const ev = (init: Partial<KeyboardEvent>) =>
  ({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...init }) as KeyboardEvent;

describe('matchesBinding for the =/+ (zoom-in) key', () => {
  const zoomIn = { key: '=', ctrl: true };

  it('matches Ctrl+= (unshifted)', () => {
    expect(matchesBinding(ev({ key: '=', ctrlKey: true }), zoomIn)).toBe(true);
  });

  it('matches Ctrl + numpad + (no shift)', () => {
    expect(matchesBinding(ev({ key: '+', ctrlKey: true }), zoomIn)).toBe(true);
  });

  it('still requires the modifier', () => {
    expect(matchesBinding(ev({ key: '=' }), zoomIn)).toBe(false);
  });
});

describe('bindingKey conflict identity', () => {
  it('keeps distinct keys distinct', () => {
    expect(bindingKey({ key: '-', ctrl: true })).not.toBe(bindingKey({ key: '=', ctrl: true }));
  });
});
