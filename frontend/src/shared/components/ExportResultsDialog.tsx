import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/shared/components/Modal';
import { api } from '@/shared/lib/api';
import { appToast, toastError } from '@/shared/lib/appToast';
import { writeChunkedFile } from '@/shared/lib/exportFile';
import { buildExport, buildExportChunks, EXPORT_FORMATS, type ExportFormat } from '@/shared/lib/exportResult';
import { exportFormatLabel } from '@/shared/lib/grid';
import type { QueryResult } from '@/types';

type RowScope = 'all' | 'selected';
type ColScope = 'all' | 'visible' | 'selected';

interface Props {
  result: QueryResult;
  sortedRowIndices: number[];
  selectedRowIndices: number[];
  visibleColumns: string[];
  allColumns: string[];
  selectedColumns: string[];
  format: ExportFormat;
  onFormatChange: (format: ExportFormat) => void;
  onClose: () => void;
}

export function ExportResultsDialog({
  result,
  sortedRowIndices,
  selectedRowIndices,
  visibleColumns,
  allColumns,
  selectedColumns,
  format,
  onFormatChange,
  onClose,
}: Props) {
  const { t } = useTranslation();
  const hasRows = selectedRowIndices.length > 0;
  const hasCols = selectedColumns.length > 0;
  // Visible only differs from All while a column is hidden; the visible list is a filter of all.
  const hasHiddenColumns = visibleColumns.length < allColumns.length;
  const defaultRowScope: RowScope = hasRows ? 'selected' : 'all';
  const defaultColScope: ColScope = hasCols ? 'selected' : hasHiddenColumns ? 'visible' : 'all';

  const [rowScope, setRowScope] = useState<RowScope>(defaultRowScope);
  const [colScope, setColScope] = useState<ColScope>(defaultColScope);
  const [busy, setBusy] = useState(false);
  // Non-null only while a write runs, so it also marks what can be stopped; copy is busy but not.
  const [progress, setProgress] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const exportOptions = useMemo(() => {
    const rowIndices =
      rowScope === 'selected' && hasRows
        ? [...selectedRowIndices].sort((a, b) => sortedRowIndices.indexOf(a) - sortedRowIndices.indexOf(b))
        : [...sortedRowIndices];

    let columns: string[];
    if (colScope === 'selected' && hasCols) {
      columns = visibleColumns.filter((c) => selectedColumns.includes(c));
    } else if (colScope === 'all') {
      columns = [...allColumns];
    } else {
      columns = [...visibleColumns];
    }

    return { columns, rowIndices };
  }, [
    rowScope,
    colScope,
    hasRows,
    hasCols,
    selectedRowIndices,
    selectedColumns,
    sortedRowIndices,
    visibleColumns,
    allColumns,
  ]);

  const copy = async () => {
    setBusy(true);
    try {
      await api.copyToClipboard(buildExport(result, format, exportOptions));
      appToast.success(t('toast.exportCopied'));
      onClose();
    } catch (e) {
      toastError(e, t('errors.copyFailed'));
    } finally {
      setBusy(false);
    }
  };

  const saveFile = async () => {
    const meta = EXPORT_FORMATS.find((f) => f.id === format);
    if (!meta) return;
    setBusy(true);
    try {
      const path = await api.pickExportSavePath(meta.ext).catch(() => '');
      if (!path) return;
      const fileName = path.split(/[/\\]/).pop() ?? path;
      const controller = new AbortController();
      abortRef.current = controller;
      setProgress(0);
      const { rows, cancelled } = await writeChunkedFile(path, buildExportChunks(result, format, exportOptions), {
        onProgress: setProgress,
        signal: controller.signal,
      });
      if (cancelled) {
        // The file exists but is incomplete; never let it pass for a finished export.
        appToast.error(t('toast.exportStopped', { fileName, count: rows }));
        return;
      }
      appToast.success(t('toast.savedFile', { fileName }));
      onClose();
    } catch (e) {
      toastError(e, t('errors.exportFailed'));
    } finally {
      setBusy(false);
      setProgress(null);
      abortRef.current = null;
    }
  };

  const dismiss = () => {
    if (progress !== null) {
      abortRef.current?.abort();
      return;
    }
    onClose();
  };

  return (
    // dismiss, not onClose: Escape and the backdrop would unmount mid-write, orphaning the export.
    <Modal title={t('export.title')} onClose={dismiss} size="sm">
      <div className="modal-body">
        <div className="form-group">
          <label htmlFor="export-format">{t('export.format')}</label>
          <select id="export-format" value={format} onChange={(e) => onFormatChange(e.target.value as ExportFormat)}>
            {EXPORT_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {exportFormatLabel(t, f.id)}
              </option>
            ))}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="export-rows-group">{t('export.rows')}</label>
          <div className="sidebar-toggle-group" id="export-rows-group" role="group" aria-label={t('export.rows')}>
            <button
              type="button"
              className={`btn btn-sm ${rowScope === 'all' ? 'active' : ''}`}
              onClick={() => setRowScope('all')}
            >
              {t('export.rowsAll', { count: sortedRowIndices.length })}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${rowScope === 'selected' ? 'active' : ''}`}
              onClick={() => setRowScope('selected')}
              disabled={!hasRows}
              data-tooltip={hasRows ? undefined : t('tooltip.exportSelectRows')}
            >
              {t('export.rowsSelected', { count: selectedRowIndices.length })}
            </button>
          </div>
        </div>
        <div className="form-group">
          <label htmlFor="export-cols-group">{t('export.columns')}</label>
          <div className="sidebar-toggle-group" id="export-cols-group" role="group" aria-label={t('export.columns')}>
            <button
              type="button"
              className={`btn btn-sm ${colScope === 'all' ? 'active' : ''}`}
              onClick={() => setColScope('all')}
            >
              {t('export.colsAll', { count: allColumns.length })}
            </button>
            {hasHiddenColumns && (
              <button
                type="button"
                className={`btn btn-sm ${colScope === 'visible' ? 'active' : ''}`}
                onClick={() => setColScope('visible')}
              >
                {t('export.colsVisible', { count: visibleColumns.length })}
              </button>
            )}
            <button
              type="button"
              className={`btn btn-sm ${colScope === 'selected' ? 'active' : ''}`}
              onClick={() => setColScope('selected')}
              disabled={!hasCols}
              data-tooltip={hasCols ? undefined : t('tooltip.exportSelectCols')}
            >
              {t('export.colsSelected', { count: selectedColumns.length })}
            </button>
          </div>
        </div>
        {progress === null ? (
          <p className="export-results-summary">
            {t('export.summary', {
              rows: exportOptions.rowIndices.length,
              cols: exportOptions.columns.length,
              format: exportFormatLabel(t, format),
            })}
          </p>
        ) : (
          <div className="export-progress" aria-live="polite">
            <p className="export-results-summary">
              {t('export.progress', { done: progress, total: exportOptions.rowIndices.length })}
            </p>
            <progress className="export-progress-bar" value={progress} max={exportOptions.rowIndices.length} />
          </div>
        )}
      </div>
      <div className="modal-footer">
        <button type="button" className="btn" onClick={dismiss} disabled={busy && progress === null}>
          {progress === null ? t('common.cancel') : t('export.stop')}
        </button>
        <button type="button" className="btn" onClick={() => void copy()} disabled={busy}>
          {t('export.copyToClipboard')}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void saveFile()} disabled={busy}>
          {t('export.saveToFile')}
        </button>
      </div>
    </Modal>
  );
}
