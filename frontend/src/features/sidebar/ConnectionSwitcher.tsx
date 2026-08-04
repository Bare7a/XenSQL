import { ChevronDown, Database, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConnectionDialog } from '@/features/connections/ConnectionDialog';
import { ConnectionsPanel } from '@/features/sidebar/ConnectionsPanel';
import { useDismissOnOutside } from '@/shared/hooks/useDismissOnOutside';
import { api } from '@/shared/lib/api';
import { basename } from '@/shared/lib/connectionLabel';
import { cx } from '@/shared/lib/cx';
import { useAppStore } from '@/store/appStore';
import { useConnectedIds, useConnections, useResolvedConnectionId, useStoreActions } from '@/store/selectors';
import type { ConnectionConfig } from '@/types';
import { DEFAULT_CONNECTION_COLOR } from '@/types';

interface Props {
  onConnected: (connectionId: string) => void;
  onOpenConnectionTab: (connectionId: string) => void;
}

export function ConnectionSwitcher({ onConnected, onOpenConnectionTab }: Props) {
  const { t } = useTranslation();
  const connections = useConnections();
  const connectedIds = useConnectedIds();
  const { setConnections } = useStoreActions();

  const [open, setOpen] = useState(false);
  // undefined = closed; null = "new" mode; populated = "edit"
  const [dialogConn, setDialogConn] = useState<ConnectionConfig | null | undefined>(undefined);

  const anchorRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 0,
  });

  const currentId = useResolvedConnectionId();
  const current = connections.find((c) => c.id === currentId) || null;
  const isConnected = !!(currentId && connectedIds[currentId]);
  const hasConnections = connections.length > 0;

  // Surfaces host/db detail as the tooltip - replaces the old schema-panel banner row.
  const detail =
    current && isConnected
      ? current.driver === 'sqlite'
        ? `sqlite · ${basename(current.filePath || '')}`
        : [current.driver, [current.host, current.database].filter(Boolean).join('/')].filter(Boolean).join(' · ')
      : '';

  // Pre-fills the new-connection dialog for an OS-supplied SQLite file, whatever the active sidebar
  // tab. Reading it as state means a file that lands before this mounts is still picked up.
  const pendingSqliteFile = useAppStore((s) => s.pendingSqliteFile);
  const clearPendingSqliteFile = useAppStore((s) => s.clearPendingSqliteFile);
  useEffect(() => {
    if (!pendingSqliteFile) return;
    setDialogConn({
      id: '',
      name: pendingSqliteFile.name,
      driver: 'sqlite',
      color: DEFAULT_CONNECTION_COLOR,
      filePath: pendingSqliteFile.filePath,
      host: 'localhost',
      port: 5432,
      database: '',
      username: '',
      password: '',
      sslMode: 'disable',
      schema: '',
    });
    clearPendingSqliteFile();
  }, [pendingSqliteFile, clearPendingSqliteFile]);

  // ignoreSelector keeps clicks in owned dialogs (.modal-overlay) from dismissing the popover.
  useDismissOnOutside(menuRef, () => setOpen(false), {
    enabled: open,
    alsoInside: [anchorRef],
    ignoreSelector: '.modal-overlay',
    onEscape: true,
  });

  const toggleMenu = () => {
    if (!hasConnections) {
      setDialogConn(null);
      return;
    }
    if (!open) {
      const rect = anchorRef.current?.getBoundingClientRect();
      if (rect) setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
    }
    setOpen(!open);
  };

  return (
    <div className="sidebar-conn-header">
      <button
        ref={anchorRef}
        type="button"
        data-testid="connection-switcher"
        className={cx('connection-switcher', !hasConnections && 'connection-switcher-empty')}
        data-tooltip={hasConnections ? detail || t('tooltip.switchConnection') : undefined}
        onClick={toggleMenu}
      >
        {hasConnections && current ? (
          <>
            <Database className="icon-sm connection-switcher-icon" style={{ color: current.color }} aria-hidden />
            <span className="connection-switcher-name" data-testid="connection-switcher-name">
              {current.name}
            </span>
            <span
              className={cx('connection-status-dot', isConnected && 'is-connected')}
              data-tooltip={isConnected ? t('sidebar.connectedLabel') : t('sidebar.notConnected')}
              aria-hidden
            />
            <ChevronDown className="icon-xs connection-switcher-caret" aria-hidden />
          </>
        ) : (
          <>
            <Plus className="icon-xs" /> {t('sidebar.newConnection')}
          </>
        )}
      </button>

      {open && (
        <div
          ref={menuRef}
          className="connection-switcher-menu"
          style={{ top: pos.top, left: pos.left, width: pos.width }}
        >
          <ConnectionsPanel
            onConnected={(id) => {
              onConnected(id);
              setOpen(false);
            }}
            onOpenTab={onOpenConnectionTab}
            onNew={() => setDialogConn(null)}
            onEdit={(c) => setDialogConn(c)}
            onRequestClose={() => setOpen(false)}
          />
        </div>
      )}

      {dialogConn !== undefined && (
        <ConnectionDialog
          key={dialogConn?.id || 'new'}
          connection={dialogConn}
          onClose={() => setDialogConn(undefined)}
          onSaved={async (c) => {
            try {
              const list = await api.listConnections();
              setConnections(list);
            } catch {
              const idx = connections.findIndex((x) => x.id === c.id);
              if (idx >= 0) {
                const next = [...connections];
                next[idx] = c;
                setConnections(next);
              } else {
                setConnections([...connections, c]);
              }
            }
          }}
        />
      )}
    </div>
  );
}
