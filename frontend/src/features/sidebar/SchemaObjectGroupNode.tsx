import { ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ObjectBadge, SchemaObjectRow } from '@/features/sidebar/lib/schemaObjects';
import { rowActivateKeyDown } from '@/shared/hooks/useListKeyboardNav';
import { cx } from '@/shared/lib/cx';

// PK/FK reuse the colours the column rows already have.
const BADGE_CLASS: Record<ObjectBadge, string> = {
  pk: 'tree-column-pk',
  fk: 'tree-column-fk',
  unique: 'tree-object-badge--unique',
  check: 'tree-object-badge--check',
  index: 'tree-object-badge--index',
  function: 'tree-object-badge--routine',
  procedure: 'tree-object-badge--routine',
};

interface Props {
  label: string;
  icon: React.ReactNode;
  rowIcon: React.ReactNode;
  open: boolean;
  loading: boolean;
  /** Undefined until first expanded. */
  rows: SchemaObjectRow[] | undefined;
  emptyLabel: string;
  testId: string;
  onToggle: () => void;
  onRowContextMenu: (e: React.MouseEvent, row: SchemaObjectRow) => void;
}

export const SchemaObjectGroupNode = memo(function SchemaObjectGroupNode({
  label,
  icon,
  rowIcon,
  open,
  loading,
  rows,
  emptyLabel,
  testId,
  onToggle,
  onRowContextMenu,
}: Props) {
  const { t } = useTranslation();

  return (
    <div>
      <div
        className="tree-item tree-item--group"
        role="button"
        tabIndex={0}
        data-nav-item
        data-testid={testId}
        onClick={onToggle}
        onKeyDown={rowActivateKeyDown}
      >
        {open ? <ChevronDown className="icon-xs" /> : <ChevronRight className="icon-xs" />}
        {icon}
        <span className="tree-label">{label}</span>
        {rows && <span className="ui-text-2xs text-muted">{rows.length}</span>}
      </div>

      {open && (
        <div className="tree-children">
          {loading && (
            <div className="tree-item tree-column text-muted">
              <Loader2 className="icon-xs spin" /> {t('sidebar.loadingObjects')}
            </div>
          )}
          {!loading && rows?.length === 0 && (
            <div className="tree-item tree-column ui-text-xs text-muted">{emptyLabel}</div>
          )}
          {!loading &&
            rows?.map((row) => (
              <div
                key={row.key}
                className="tree-item tree-column tree-object"
                role="button"
                tabIndex={0}
                data-nav-item
                data-testid={`${testId}-row`}
                data-object={row.key}
                data-tooltip={t('tooltip.schemaObjectRow')}
                onClick={() => {}}
                onKeyDown={rowActivateKeyDown}
                onContextMenu={(e) => onRowContextMenu(e, row)}
              >
                {rowIcon}
                <span className="tree-column-name">{row.label}</span>
                {row.badge && (
                  <span className={cx('tree-object-badge', BADGE_CLASS[row.badge])}>
                    {t(`sidebar.badge.${row.badge}`)}
                  </span>
                )}
                {row.detail && <span className="tree-object-detail">{row.detail}</span>}
              </div>
            ))}
        </div>
      )}
    </div>
  );
});
