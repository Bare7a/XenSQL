import { Bookmark, type LucideIcon, Table2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ConnectionSwitcher } from '@/features/sidebar/ConnectionSwitcher';
import { QueriesPanel } from '@/features/sidebar/QueriesPanel';
import { SchemaPanel } from '@/features/sidebar/SchemaPanel';
import { ErrorBoundary } from '@/shared/components/ErrorBoundary';
import { useAppStore } from '@/store/appStore';
import { useSelectedConnectionId } from '@/store/selectors';
import type { SavedQuery } from '@/types';

interface Props {
  onOpenQuery: (connId: string, sql?: string, options?: { forceNew?: boolean; title?: string }) => void;
  onOpenSavedQuery: (saved: SavedQuery) => void;
  onBrowseTable: (connId: string, schema: string, table: string) => void;
  onOpenConnectionTab: (connId: string) => void;
}

type SidebarView = 'schema' | 'queries';

const VIEWS: ReadonlyArray<[SidebarView, string, LucideIcon]> = [
  ['schema', 'sidebar.schema', Table2],
  ['queries', 'sidebar.queries', Bookmark],
];

export function Sidebar({ onOpenQuery, onOpenSavedQuery, onBrowseTable, onOpenConnectionTab }: Props) {
  const { t } = useTranslation();
  const sidebarView = useAppStore((s) => s.sidebarView);
  const setSidebarView = useAppStore((s) => s.setSidebarView);
  const selectedConnectionId = useSelectedConnectionId();

  return (
    <aside className="sidebar" data-testid="sidebar">
      <ConnectionSwitcher onConnected={() => setSidebarView('schema')} onOpenConnectionTab={onOpenConnectionTab} />

      <div className="sidebar-tabs">
        {VIEWS.map(([view, labelKey, Icon]) => (
          <button
            key={view}
            type="button"
            className={`sidebar-tab ${sidebarView === view ? 'active' : ''}`}
            onClick={() => setSidebarView(view)}
          >
            <Icon className="icon-xs" aria-hidden />
            {t(labelKey)}
          </button>
        ))}
      </div>

      <div className="sidebar-content">
        {sidebarView === 'schema' && (
          <ErrorBoundary label={t('errorBoundary.schema')} resetKey={selectedConnectionId}>
            <SchemaPanel
              onOpenQuery={onOpenQuery}
              onBrowseTable={onBrowseTable}
              onOpenConnectionTab={onOpenConnectionTab}
            />
          </ErrorBoundary>
        )}

        {sidebarView === 'queries' && (
          <ErrorBoundary label={t('errorBoundary.queries')} resetKey={selectedConnectionId}>
            <QueriesPanel onOpenQuery={onOpenQuery} onOpenSavedQuery={onOpenSavedQuery} />
          </ErrorBoundary>
        )}
      </div>
    </aside>
  );
}
