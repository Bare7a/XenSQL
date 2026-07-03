import { useCallback, useEffect, useRef } from 'react';
import { rowToJsonObject } from '@/shared/lib/rowJson';
import type { QueryResult } from '@/types';

type PublishFocusedRow = (globalIdx: number | null) => void;

interface UseResultsFocusPublishOptions {
  publishRef: React.RefObject<PublishFocusedRow>;
  /** Inactive grids stay mounted but must not drive the focused-row panel. */
  isActive: boolean;
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
  isActive,
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
  const isActiveRef = useRef(isActive);
  isActiveRef.current = isActive;

  const publishFocusedRow = useCallback(
    (globalIdx: number | null) => {
      if (!isActiveRef.current) return;
      if (globalIdx == null || !result) {
        onFocusedRowChangeRef.current?.(null);
        return;
      }
      const row = result.rows[globalIdx];
      if (!row) return;
      onFocusedRowChangeRef.current?.(rowToJsonObject(columns, visibleColumns, row, columnIndexByName));
    },
    [result, columns, visibleColumns, columnIndexByName],
  );
  publishRef.current = publishFocusedRow;

  // streamId keeps streaming batches from re-publishing; isActive makes the panel follow result-tab switches.
  useEffect(() => {
    if (isActive) publishRef.current(focusedRowIdx);
  }, [hiddenColumns, focusedRowIdx, streamId, isActive, publishRef]);
}
