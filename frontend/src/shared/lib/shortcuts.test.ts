import { describe, expect, it } from 'vitest';
import { bindingFromKeyboardEvent, bindingKey, matchesBinding } from '@/shared/lib/shortcuts';

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

describe('matchesBinding on non-Latin layouts (falls back to the physical key)', () => {
  it('matches Ctrl+T when Bulgarian Phonetic produces т', () => {
    expect(matchesBinding(ev({ key: 'т', code: 'KeyT', ctrlKey: true }), { key: 't', ctrl: true })).toBe(true);
  });

  it('matches Cmd+Shift+Т (uppercase Cyrillic) for reopenClosedTab', () => {
    expect(
      matchesBinding(ev({ key: 'Т', code: 'KeyT', metaKey: true, shiftKey: true }), {
        key: 't',
        ctrl: true,
        shift: true,
      }),
    ).toBe(true);
  });

  it('maps punctuation positions (ю on Period → Ctrl+Shift+.)', () => {
    expect(
      matchesBinding(ev({ key: 'Ю', code: 'Period', ctrlKey: true, shiftKey: true }), {
        key: '.',
        ctrl: true,
        shift: true,
      }),
    ).toBe(true);
  });

  it('keeps Latin layouts label-driven (AZERTY a sits on KeyQ)', () => {
    expect(matchesBinding(ev({ key: 'a', code: 'KeyQ', ctrlKey: true }), { key: 'a', ctrl: true })).toBe(true);
    expect(matchesBinding(ev({ key: 'a', code: 'KeyQ', ctrlKey: true }), { key: 'q', ctrl: true })).toBe(false);
  });
});

describe('bindingFromKeyboardEvent on non-Latin layouts', () => {
  it('records the physical Latin key, not the produced character', () => {
    expect(bindingFromKeyboardEvent(ev({ key: 'в', code: 'KeyW', ctrlKey: true }))).toEqual({
      key: 'w',
      ctrl: true,
      shift: false,
      alt: false,
    });
  });
});
