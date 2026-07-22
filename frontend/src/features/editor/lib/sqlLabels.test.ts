import i18n from 'i18next';
import { describe, expect, it } from 'vitest';
import { sqlLabels } from '@/features/editor/lib/sqlLabels';

describe('sqlLabels', () => {
  it('returns the same memoized object until the language changes', async () => {
    await i18n.changeLanguage('en');
    const first = sqlLabels();
    expect(first.notNull).toBe('not null');
    expect(sqlLabels()).toBe(first);

    await i18n.changeLanguage('de');
    const german = sqlLabels();
    expect(german).not.toBe(first);
    expect(german.table).toBe('Tabelle');

    await i18n.changeLanguage('en');
    expect(sqlLabels().table).toBe('table');
  });
});
