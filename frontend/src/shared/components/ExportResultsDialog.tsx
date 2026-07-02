import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/shared/components/Modal';
import { api } from '@/shared/lib/api';
import { appToast, toastError } from '@/shared/lib/appToast';
import { buildExport, EXPORT_FORMATS, type ExportFormat } from '@/shared/lib/exportResult';
import { exportFormatLabel } from '@/shared/lib/grid';
import type { QueryResult } from '@/types';

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
  const defaultRowScope: 'all' | 'selected' = hasCols && !hasRows ? 'all' : hasRows ? 'selected' : 'all';
  const defaultColScope: 'visible' | 'all' | 'selected' =
    hasRows && !hasCols ? 'visible' : hasCols ? 'selected' : 'visible';

  const [rowScope, setRowScope] = useState<'all' | 'selected'>(defaultRowScope);
  const [colScope, setColScope] = useState<'visible' | 'all' | 'selected'>(defaultColScope);
  const [busy, setBusy] = useState(false);

  const canExportSelectedRows = selectedRowIndices.length > 0;
  const canExportSelectedCols = selectedColumns.length > 0;

  const exportOptions = useMemo(() => {
    const rowIndices =
      rowScope === 'selected' && canExportSelectedRows
        ? [...selectedRowIndices].sort((a, b) => sortedRowIndices.indexOf(a) - sortedRowIndices.indexOf(b))
        : [...sortedRowIndices];

    let columns: string[];
    if (colScope === 'selected' && canExportSelectedCols) {
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
    canExportSelectedRows,
    canExportSelectedCols,
    selectedRowIndices,
    selectedColumns,
    sortedRowIndices,
    visibleColumns,
    allColumns,
  ]);

  const runExport = () => buildExport(result, format, exportOptions);

  const copy = async () => {
    setBusy(true);
    try {
      const text = runExport();
      await api.copyToClipboard(text);
      appToast.success(t('toast.exportCopied'));
      onClose();
    } catch (e) {
      toastError(e, t('errors.copyFailed'));
    } finally {
      setBusy(false);
    }
  };

  const saveFile = async () => {
    setBusy(true);
    try {
      const text = runExport();
      const meta = EXPORT_FORMATS.find((f) => f.id === format);
      if (!meta) return;
      const path = await api.pickExportSavePath(meta.ext).catch(() => '');
      if (!path) return;
      await api.saveTextFile(path, text);
      const fileName = path.split(/[/\\]/).pop() ?? path;
      appToast.success(t('toast.savedFile', { fileName }));
      onClose();
    } catch (e) {
      toastError(e, t('errors.exportFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('export.title')} onClose={onClose} size="sm">
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
              disabled={!canExportSelectedRows}
              data-tooltip={canExportSelectedRows ? undefined : t('tooltip.exportSelectRows')}
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
            <button
              type="button"
              className={`btn btn-sm ${colScope === 'visible' ? 'active' : ''}`}
              onClick={() => setColScope('visible')}
            >
              {t('export.colsVisible', { count: visibleColumns.length })}
            </button>
            <button
              type="button"
              className={`btn btn-sm ${colScope === 'selected' ? 'active' : ''}`}
              onClick={() => setColScope('selected')}
              disabled={!canExportSelectedCols}
              data-tooltip={canExportSelectedCols ? undefined : t('tooltip.exportSelectCols')}
            >
              {t('export.colsSelected', { count: selectedColumns.length })}
            </button>
          </div>
        </div>
        <p className="export-results-summary">
          {t('export.summary', {
            rows: exportOptions.rowIndices.length,
            cols: exportOptions.columns.length,
            format: exportFormatLabel(t, format),
          })}
        </p>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn" onClick={onClose} disabled={busy}>
          {t('common.cancel')}
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
