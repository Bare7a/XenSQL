import { describe, expect, it } from 'vitest';
import bg from '@/i18n/locales/bg.json';
import de from '@/i18n/locales/de.json';
import en from '@/i18n/locales/en.json';

type Bundle = Record<string, unknown>;

function flatten(bundle: Bundle, prefix = ''): string[] {
  return Object.entries(bundle).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value !== null && typeof value === 'object' ? flatten(value as Bundle, path) : [path];
  });
}

const translations = { de, bg };

describe('locales', () => {
  const english = flatten(en).sort();

  it('has keys in English', () => {
    expect(english.length).toBeGreaterThan(0);
  });

  for (const [language, bundle] of Object.entries(translations)) {
    describe(language, () => {
      const keys = flatten(bundle as Bundle).sort();

      it('translates every English key', () => {
        expect(english.filter((key) => !keys.includes(key))).toEqual([]);
      });

      it('has no keys English is missing', () => {
        expect(keys.filter((key) => !english.includes(key))).toEqual([]);
      });

      it('leaves no value empty', () => {
        const empty = flatten(bundle as Bundle).filter((key) => {
          const value = key.split('.').reduce<unknown>((node, part) => (node as Bundle)?.[part], bundle);
          return typeof value === 'string' && value.trim() === '';
        });
        expect(empty).toEqual([]);
      });
    });
  }
});
