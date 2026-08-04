import { useCallback, useEffect, useState } from 'react';
import {
  buildForeignKeyFilter,
  type ForeignKeyTarget,
  foreignKeyTargetsFrom,
} from '@/features/table-view/lib/foreignKeyFilter';
import { api } from '@/shared/lib/api';
import { cachedColumns } from '@/shared/lib/columnCache';
import type { DriverType } from '@/types';

const NO_FOREIGN_KEYS: Record<string, ForeignKeyTarget> = {};

export interface ForeignKeyJump {
  table: string;
  filter: string;
}

export function useTableViewForeignKeys(connectionId: string, schema: string, table: string, driver: DriverType) {
  const [foreignKeys, setForeignKeys] = useState<Record<string, ForeignKeyTarget>>(NO_FOREIGN_KEYS);

  useEffect(() => {
    let cancelled = false;
    setForeignKeys(NO_FOREIGN_KEYS);
    // A metadata failure just means no FK buttons.
    void cachedColumns(connectionId, schema, table, () => api.listColumns(connectionId, schema, table))
      .then((cols) => {
        if (!cancelled) setForeignKeys(foreignKeyTargetsFrom(cols));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [connectionId, schema, table]);

  const resolveJump = useCallback(
    async (column: string, value: unknown): Promise<ForeignKeyJump | null> => {
      const target = foreignKeys[column];
      if (!target) return null;
      let targetColumn = target.column;
      if (!targetColumn) {
        // SQLite records no column for an implicit primary-key reference.
        const cols = await cachedColumns(connectionId, schema, target.table, () =>
          api.listColumns(connectionId, schema, target.table),
        );
        targetColumn = cols.find((c) => c.isPrimary)?.name ?? '';
        if (!targetColumn) return null;
      }
      return { table: target.table, filter: buildForeignKeyFilter(targetColumn, value, driver) };
    },
    [foreignKeys, connectionId, schema, driver],
  );

  return { foreignKeys, resolveJump };
}
