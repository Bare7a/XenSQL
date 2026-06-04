import { useCallback, useEffect, useRef } from 'react';
import { rowToJsonObject } from '@/shared/lib/rowJson';
import type { QueryResult } from '@/types';

type PublishFocusedRow = (globalIdx: number | null) => void;

interface UseResultsFocusPublishOptions {
  publishRef: React.RefObject<PublishFocusedRow>;
  result: QueryResult | null;
  columns: string[];
  visibleColumns: string[];
  columnIndexByName: Map<string, number>;
  hiddenColumns: Set<string>;
  focusedRowIdx: number | null;
  streamId: string | undefined;
  onFocusedRowChange?: (row: Record<string, unknown> | null) => void;
}

export function useResultsFocusPublish({
  publishRef,
  result,
  columns,
  visibleColumns,
  columnIndexByName,
  hiddenColumns,
  focusedRowIdx,
  streamId,
  onFocusedRowChange,
}: UseResultsFocusPublishOptions) {
  const onFocusedRowChangeRef = useRef(onFocusedRowChange);
  onFocusedRowChangeRef.current = onFocusedRowChange;

  const publishFocusedRow = useCallback(
    (globalIdx: number | null) => {
      if (globalIdx == null || !result) {
        onFocusedRowChangeRef.current?.(null);
        return;
      }
      const row = result.rows[globalIdx];
      if (!row) return;
      onFocusedRowChangeRef.current?.(
        rowToJsonObject(columns, visibleColumns, row, columnIndexByName)
      );
    },
    [result, columns, visibleColumns, columnIndexByName]
  );
  publishRef.current = publishFocusedRow;

  // Keyed on streamId so streaming row appends don't re-publish on every batch.
  useEffect(() => {
    if (focusedRowIdx != null) publishRef.current(focusedRowIdx);
  }, [hiddenColumns, focusedRowIdx, streamId, publishRef]);
}
