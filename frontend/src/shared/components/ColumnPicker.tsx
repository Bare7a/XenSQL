import { Columns3 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface Props {
  columns: string[];
  hidden: Set<string>;
  onToggle: (column: string) => void;
  onShowAll: () => void;
  onHideAll: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ColumnPicker({
  columns,
  hidden,
  onToggle,
  onShowAll,
  onHideAll,
  open,
  onOpenChange,
}: Props) {
  const { t } = useTranslation();
  const visibleCount = columns.length - hidden.size;

  return (
    <div className="column-picker-wrap">
      <button
        type="button"
        className={`btn btn-sm ${open ? 'active' : ''}`}
        onClick={() => onOpenChange(!open)}
        data-tooltip={t('tooltip.showHideColumns')}
      >
        <Columns3 className="icon-xs" /> {t('common.columns')} ({visibleCount}/{columns.length})
      </button>
      {open && (
        <>
          <div className="column-picker-backdrop" onClick={() => onOpenChange(false)} />
          <div className="column-picker-panel">
            <div className="column-picker-actions">
              <button type="button" className="btn btn-sm" onClick={onShowAll}>
                {t('common.showAll')}
              </button>
              <button type="button" className="btn btn-sm" onClick={onHideAll}>
                {t('common.hideAll')}
              </button>
            </div>
            <ul className="column-picker-list">
              {columns.map((col) => {
                const isVisible = !hidden.has(col);
                return (
                  <li key={col}>
                    <label className="column-picker-item">
                      <input
                        type="checkbox"
                        checked={isVisible}
                        onChange={() => onToggle(col)}
                      />
                      <span>{col}</span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
