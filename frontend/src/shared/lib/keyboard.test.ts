import { describe, expect, it } from 'vitest';
import { shortcutKey } from '@/shared/lib/keyboard';

const ev = (key: string, code?: string) => ({ key, code }) as KeyboardEvent;

describe('shortcutKey', () => {
  it('passes ASCII keys through untouched', () => {
    expect(shortcutKey(ev('t', 'KeyT'))).toBe('t');
    expect(shortcutKey(ev('=', 'Equal'))).toBe('=');
    expect(shortcutKey(ev('Enter', 'Enter'))).toBe('Enter');
    expect(shortcutKey(ev('F11', 'F11'))).toBe('F11');
  });

  it('maps non-Latin characters to the physical key (Bulgarian Phonetic)', () => {
    expect(shortcutKey(ev('т', 'KeyT'))).toBe('t');
    expect(shortcutKey(ev('Б', 'KeyB'))).toBe('b');
    expect(shortcutKey(ev('ю', 'Period'))).toBe('.');
  });

  it('maps digits by position', () => {
    expect(shortcutKey(ev('э', 'Digit0'))).toBe('0');
  });

  it('keeps the produced character when the code is unmapped', () => {
    expect(shortcutKey(ev('§', 'IntlBackslash'))).toBe('§');
    expect(shortcutKey(ev('т', undefined))).toBe('т');
  });
});
