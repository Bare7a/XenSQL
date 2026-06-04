import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/shared/lib/api';
import { appError } from '@/shared/lib/appDialog';
import { appToast } from '@/shared/lib/appToast';
import {
  EXPORT_FORMATS,
  buildExport,
  formatCellCopyValue,
  readStoredExportFormat,
  resolveCopySelection,
  shouldCopySingleCell,
  storeExportFormat,
  type ExportFormat,
  type ExportOptions,
} from '@/shared/lib/exportResult';
import { identityIndices } from '@/shared/lib/grid';
import type { QueryResult } from '@/types';

export interface GridSelectionSnapshot {
  rows: Set<number>;
  cols: Set<string>;
}

export interface GridFocusSnapshot {
  row: number | null;
  colPos: number;
}

export interface CopiedCells {
  /** The exact text written to the clipboard (used to recognize an internal paste verbatim). */
  text: string;
  /** The copied selection as a 2D grid of values, NULLs preserved, in display row/column order. */
  cells: (string | null)[][];
}

export interface CopyExportInputs {
  result: QueryResult | null;
  displayColumns: string[];
  columnIndexByName: Map<string, number>;
  sortedRowIndices: number[] | null;
  sortedRowCount: number;
  selectionRef: React.RefObject<GridSelectionSnapshot>;
  focusRef: React.RefObject<GridFocusSnapshot>;
  /** Fires after a successful copy so callers can keep a structured buffer for offset paste. */
  onCopied?: (copied: CopiedCells) => void;
}

// Materialize the copied selection as a 2D value grid, mirroring pickSubset's column/row resolution
// so it lines up with the exported text.
function selectionCells(result: QueryResult, opts: ExportOptions): (string | null)[][] {
  const colIndices = opts.columns.map((c) => result.columns.indexOf(c));
  return opts.rowIndices.map((ri) => {
    const row = result.rows[ri];
    return colIndices.map((ci) => {
      const v = ci >= 0 && row ? row[ci] : null;
      return v == null ? null : String(v);
    });
  });
}

export interface GridCopyExport {
  copyFormat: ExportFormat;
  setCopyFormat: (format: ExportFormat) => void;
  /** Disables action buttons while a Wails save dialog is open. */
  exportBusy: boolean;
  /** `allowSingleCell` enables the focused-cell shortcut when nothing else is selected. */
  copyToClipboard: (allowSingleCell: boolean) => Promise<void>;
  exportToFile: () => Promise<void>;
}

export function useGridCopyExport(inputs: CopyExportInputs): GridCopyExport {
  const { t } = useTranslation();
  const [copyFormat, setCopyFormatState] = useState<ExportFormat>(() => readStoredExportFormat());
  const [exportBusy, setExportBusy] = useState(false);

  // Ref keeps callbacks stable across re-renders; without it the Ctrl+C listener re-attaches on every render.
  const inputsRef = useRef(inputs);
  inputsRef.current = inputs;

  const setCopyFormat = useCallback((format: ExportFormat) => {
    setCopyFormatState(format);
    storeExportFormat(format);
  }, []);

  const copyToClipboard = useCallback(
    async (allowSingleCell: boolean) => {
      const {
        result,
        displayColumns,
        columnIndexByName,
        sortedRowIndices,
        sortedRowCount,
        selectionRef,
        focusRef,
      } = inputsRef.current;
      if (!result) return;
      const { rows, cols } = selectionRef.current;
      const { row: focusedRow, colPos } = focusRef.current;

      if (
        allowSingleCell &&
        shouldCopySingleCell({
          focusedRowIdx: focusedRow,
          focusedColPos: colPos,
          selectedRows: rows,
          selectedColumns: cols,
        })
      ) {
        const col = displayColumns[colPos];
        const ci = columnIndexByName.get(col) ?? -1;
        const cell = result.rows[focusedRow!][ci];
        const text = formatCellCopyValue(cell);
        await api.copyToClipboard(text);
        inputsRef.current.onCopied?.({ text, cells: [[cell == null ? null : String(cell)]] });
        appToast.success(t('toast.copiedCell'));
        return;
      }

      const opts = resolveCopySelection({
        selectedRows: rows,
        selectedColumns: cols,
        displayColumns,
          // Materialize identity indices here (rare copy path), not on every result swap.
        sortedRowIndices: sortedRowIndices ?? identityIndices(sortedRowCount),
      });
      const text = buildExport(result, copyFormat, opts);
      await api.copyToClipboard(text);
      inputsRef.current.onCopied?.({ text, cells: selectionCells(result, opts) });
      appToast.success(t('toast.copiedClipboard'));
    },
    [copyFormat, t]
  );

  const exportToFile = useCallback(async () => {
    const {
      result,
      displayColumns,
      sortedRowIndices,
      sortedRowCount,
      selectionRef,
    } = inputsRef.current;
    if (!result) return;
    const { rows, cols } = selectionRef.current;
    const opts = resolveCopySelection({
      selectedRows: rows,
      selectedColumns: cols,
      displayColumns,
      sortedRowIndices: sortedRowIndices ?? identityIndices(sortedRowCount),
    });
    const text = buildExport(result, copyFormat, opts);
    const meta = EXPORT_FORMATS.find((f) => f.id === copyFormat)!;

    setExportBusy(true);
    try {
      const path = await api.pickExportSavePath(meta.ext);
      if (!path) return;
      await api.saveTextFile(path, text);
      appToast.success(
        t('toast.savedFile', { fileName: path.split(/[/\\]/).pop() ?? path })
      );
    } catch (e) {
      void appError(e, t('errors.exportFailed'));
    } finally {
      setExportBusy(false);
    }
  }, [copyFormat, t]);

  return {
    copyFormat,
    setCopyFormat,
    exportBusy,
    copyToClipboard,
    exportToFile,
  };
}
