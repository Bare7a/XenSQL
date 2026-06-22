import { ChevronDown, Plus } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConnectionDialog } from '@/features/connections/ConnectionDialog';
import { ConnectionsPanel } from '@/features/sidebar/ConnectionsPanel';
import { api } from '@/shared/lib/api';
import { basename } from '@/shared/lib/connectionLabel';
import { cx } from '@/shared/lib/cx';
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

  // Always-mounted OS SQLite-drop listener; pre-fills the new-connection dialog regardless of active sidebar tab.
  useEffect(() => {
    const handler = (e: Event) => {
      const { filePath, name } = (e as CustomEvent<{ filePath: string; name: string }>).detail;
      setDialogConn({
        id: '',
        name,
        driver: 'sqlite',
        color: DEFAULT_CONNECTION_COLOR,
        filePath,
        host: 'localhost',
        port: 5432,
        database: '',
        username: '',
        password: '',
        sslMode: 'disable',
        schema: '',
      });
    };
    window.addEventListener('xensql:open-sqlite', handler);
    return () => window.removeEventListener('xensql:open-sqlite', handler);
  }, []);

  // Ignore clicks inside .modal-overlay so owned dialogs don't dismiss the popover.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('.modal-overlay')) return;
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, [open]);

  return (
    <div className="sidebar-conn-header">
      <button
        ref={anchorRef}
        type="button"
        data-testid="connection-switcher"
        className={cx('connection-switcher', !hasConnections && 'connection-switcher-empty')}
        data-tooltip={hasConnections ? detail || t('tooltip.switchConnection') : undefined}
        onClick={() => {
          if (!hasConnections) setDialogConn(null);
          else setOpen((v) => !v);
        }}
      >
        {hasConnections && current ? (
          <>
            <span className="connection-dot" style={{ background: current.color }} />
            <span className="connection-switcher-name" data-testid="connection-switcher-name">
              {current.name}
            </span>
            {isConnected && <span className="connection-switcher-pip" aria-hidden />}
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
