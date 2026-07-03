import { ClipboardCopy, Columns3, Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toastError } from '@/shared/lib/appToast';
import { EXPORT_FORMATS, type ExportFormat } from '@/shared/lib/exportResult';
import { exportFormatLabel } from '@/shared/lib/grid';

interface GridToolbarProps {
  metaText: string;
  loadingText?: string;
  selectionRows?: number;
  selectionCols?: number;
  onFitColumns: () => void;
  extraLeft?: React.ReactNode;
  extraRight?: React.ReactNode;
  copyFormat: ExportFormat;
  onFormatChange: (format: ExportFormat) => void;
  exportBusy: boolean;
  onCopy: () => Promise<void>;
  onExportToFile: () => Promise<void>;
  onExportAs: () => void;
}

export function GridToolbar({
  metaText,
  loadingText,
  selectionRows,
  selectionCols,
  onFitColumns,
  extraLeft,
  extraRight,
  copyFormat,
  onFormatChange,
  exportBusy,
  onCopy,
  onExportToFile,
  onExportAs,
}: GridToolbarProps) {
  const { t } = useTranslation();

  // Only surface a count for a genuine multi-cell selection; a single focused cell (1 × 1) is noise.
  const showSelectionCount =
    selectionRows != null &&
    selectionCols != null &&
    selectionRows > 0 &&
    selectionCols > 0 &&
    (selectionRows > 1 || selectionCols > 1);

  return (
    <div className="results-header">
      <span className="results-header-meta">
        {metaText}
        {loadingText ? ` · ${loadingText}` : ''}
        {showSelectionCount && (
          <span className="results-selection-count">
            {' · '}
            {selectionRows} × {selectionCols} selected
          </span>
        )}
      </span>

      <div className="results-header-actions">
        <button type="button" className="btn btn-sm" onClick={onFitColumns} data-tooltip={t('tooltip.fitColumns')}>
          <Columns3 className="icon-xs" /> {t('results.fitColumns')}
        </button>

        {extraLeft}

        <label className="results-format-label">
          <span className="sr-only">{t('results.copyFormatSr')}</span>
          <select
            className="results-format-select"
            value={copyFormat}
            onChange={(e) => onFormatChange(e.target.value as ExportFormat)}
            data-tooltip={t('tooltip.copyFormat')}
          >
            {EXPORT_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {exportFormatLabel(t, f.id)}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="btn btn-sm"
          disabled={exportBusy}
          onClick={() => void onCopy().catch((e) => toastError(e, t('errors.copyFailed')))}
          data-tooltip={t('tooltip.copyResults')}
        >
          <ClipboardCopy className="icon-xs" /> {t('common.copy')}
        </button>

        <button
          type="button"
          className="btn btn-sm"
          disabled={exportBusy}
          onClick={() => void onExportToFile()}
          data-tooltip={t('tooltip.exportFile')}
        >
          <Download className="icon-xs" /> {t('results.export')}
        </button>

        <button
          type="button"
          className="btn btn-sm"
          disabled={exportBusy}
          onClick={onExportAs}
          data-tooltip={t('tooltip.exportOptions')}
        >
          <Download className="icon-xs" /> {t('results.exportAs')}
        </button>

        {extraRight}
      </div>
    </div>
  );
}
