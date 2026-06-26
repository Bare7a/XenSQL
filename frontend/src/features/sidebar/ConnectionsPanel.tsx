import { ChevronDown, ChevronRight, Database, Folder, FolderPlus, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ConnectionItem } from '@/features/sidebar/ConnectionItem';
import { useConnectionDnD } from '@/features/sidebar/hooks/useConnectionDnD';
import { useFolderActions } from '@/features/sidebar/hooks/useFolderActions';
import { ContextMenu, type ContextMenuItem } from '@/shared/components/ContextMenu';
import { useContextMenu } from '@/shared/hooks/useContextMenu';
import { rowActivateKeyDown, useListKeyboardNav } from '@/shared/hooks/useListKeyboardNav';
import { api } from '@/shared/lib/api';
import { appConfirm, appError } from '@/shared/lib/appDialog';
import { cx } from '@/shared/lib/cx';
import { readStoredJson, STORAGE_KEYS, writeStoredJson } from '@/shared/lib/storageKeys';
import {
  useConnectedIds,
  useConnections,
  useFolders,
  useSelectedConnectionId,
  useStoreActions,
} from '@/store/selectors';
import type { ConnectionConfig } from '@/types';

interface ConnectionsPanelProps {
  onConnected: (connectionId: string) => void;
  onOpenTab: (connectionId: string) => void;
  onNew: () => void;
  onEdit: (conn: ConnectionConfig) => void;
  onRequestClose: () => void;
}

export function ConnectionsPanel({ onConnected, onOpenTab, onNew, onEdit, onRequestClose }: ConnectionsPanelProps) {
  const { t } = useTranslation();
  const connections = useConnections();
  const folders = useFolders();
  const connectedIds = useConnectedIds();
  const selectedConnectionId = useSelectedConnectionId();
  const { setConnections, setConnected, setSelectedConnection, reorderConnections, clearConnectionCache } =
    useStoreActions();

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    readStoredJson(STORAGE_KEYS.foldersCollapsed, {}),
  );
  const { menu, openMenu, closeMenu } = useContextMenu();

  const { onKeyDown } = useListKeyboardNav();

  useEffect(() => writeStoredJson(STORAGE_KEYS.foldersCollapsed, collapsed), [collapsed]);

  const refreshConnections = useCallback(async () => {
    try {
      setConnections(await api.listConnections());
    } catch (err) {
      void appError(err, t('errors.generic'));
    }
  }, [setConnections, t]);

  const { moveToFolder, createFolder, renameFolder, deleteFolder } = useFolderActions(refreshConnections);

  const { dragConnId, dropConnId, dropFolderId, connectionDragProps, folderDropProps } = useConnectionDnD({
    reorderConnections,
    moveToFolder,
  });

  const handleConnect = useCallback(
    async (c: ConnectionConfig) => {
      setSelectedConnection(c.id);
      try {
        await api.connect(c.id);
        setConnected(c.id, true);
        onConnected(c.id);
        onOpenTab(c.id);
      } catch (err) {
        void appError(err, t('errors.couldNotConnect'));
      }
    },
    [onConnected, onOpenTab, setConnected, setSelectedConnection, t],
  );

  const handleDisconnect = (id: string) => {
    api.disconnect(id);
    setConnected(id, false);
    clearConnectionCache(id);
  };

  const handleDelete = async (id: string) => {
    const conn = connections.find((c) => c.id === id);
    const ok = await appConfirm({
      title: t('dialog.deleteConnectionTitle'),
      description: conn
        ? t('dialog.deleteConnectionDescription', { name: conn.name })
        : t('dialog.deleteConnectionDescriptionGeneric'),
      detail: t('dialog.deleteConnectionDetail'),
      confirmLabel: t('dialog.deleteConnectionConfirm'),
      danger: true,
    });
    if (!ok) return;
    try {
      const deleted = await api.deleteConnection(id);
      if (!deleted) {
        void appError(new Error('delete failed'), t('errors.generic'));
        return;
      }
      setConnections(connections.filter((c) => c.id !== id));
      clearConnectionCache(id);
    } catch (err) {
      void appError(err, t('errors.generic'));
      await refreshConnections();
    }
  };

  const openConnMenu = useCallback(
    (e: React.MouseEvent, c: ConnectionConfig) => {
      const items: ContextMenuItem[] = [
        {
          label: connectedIds[c.id] ? t('tooltip.disconnect') : t('tooltip.connect'),
          action: () => (connectedIds[c.id] ? handleDisconnect(c.id) : void handleConnect(c)),
        },
        { label: t('common.edit'), action: () => onEdit(c) },
        {
          label: t('sidebar.duplicate'),
          action: () => onEdit({ ...c, id: '', name: t('sidebar.duplicateSuffix', { name: c.name }) }),
        },
      ];
      if (folders.length > 0) {
        items.push({ label: '', action: () => {}, separator: true });
        for (const f of folders) {
          items.push({
            label: t('sidebar.moveToFolder', { name: f.name }),
            action: () => void moveToFolder(c.id, f.id),
            disabled: c.folderId === f.id,
          });
        }
        if (c.folderId) {
          items.push({
            label: t('sidebar.removeFromFolder'),
            action: () => void moveToFolder(c.id, ''),
          });
        }
      }
      items.push(
        { label: '', action: () => {}, separator: true },
        { label: t('common.delete'), action: () => void handleDelete(c.id) },
      );
      openMenu(e, items);
    },
    [connectedIds, folders, handleConnect, onEdit, moveToFolder, openMenu, t],
  );

  const renderConnection = (c: ConnectionConfig) => (
    <ConnectionItem
      key={c.id}
      conn={c}
      isSelected={selectedConnectionId === c.id}
      isConnected={!!connectedIds[c.id]}
      isDragging={dragConnId === c.id}
      isDropTarget={dropConnId === c.id}
      dragProps={connectionDragProps(c)}
      onActivate={() => {
        if (connectedIds[c.id]) onOpenTab(c.id);
        else setSelectedConnection(c.id);
        onRequestClose();
      }}
      onContextMenu={(e) => openConnMenu(e, c)}
      onConnect={() => void handleConnect(c)}
      onDisconnect={() => handleDisconnect(c.id)}
      onEdit={() => onEdit(c)}
      onDelete={() => void handleDelete(c.id)}
    />
  );

  const folderIds = new Set(folders.map((f) => f.id));
  const ungrouped = connections.filter((c) => !c.folderId || !folderIds.has(c.folderId));

  return (
    <>
      <div className="sidebar-connections-toolbar">
        <button type="button" className="btn btn-sm btn-block" onClick={onNew}>
          <Plus className="icon-xs" /> {t('sidebar.newConnection')}
        </button>
        <button
          type="button"
          className="btn btn-sm sidebar-icon-btn"
          data-tooltip={t('sidebar.newFolder')}
          onClick={() => void createFolder()}
        >
          <FolderPlus className="icon-xs" />
        </button>
      </div>

      {connections.length === 0 ? (
        <div className="empty-state">
          <Database className="icon-2xl" />
          <p>{t('sidebar.noConnectionsYet')}</p>
        </div>
      ) : (
        /* biome-ignore lint/a11y/noStaticElementInteractions: keyboard-navigation container (arrow/Home/End roving focus over its focusable rows via useListKeyboardNav); not itself an interactive control. */
        <div className="connection-list" onKeyDown={onKeyDown}>
          {ungrouped.map(renderConnection)}

          {folders.map((f) => {
            const isCollapsed = collapsed[f.id];
            const conns = connections.filter((c) => c.folderId === f.id);
            return (
              <div key={f.id} className={cx('connection-folder', dropFolderId === f.id && 'drag-over')}>
                <div
                  className="connection-folder-header"
                  role="button"
                  tabIndex={0}
                  onClick={() => setCollapsed((m) => ({ ...m, [f.id]: !m[f.id] }))}
                  onKeyDown={rowActivateKeyDown}
                  onContextMenu={(e) =>
                    openMenu(e, [
                      { label: t('sidebar.renameFolder'), action: () => void renameFolder(f.id, f.name) },
                      { label: t('common.delete'), action: () => void deleteFolder(f.id, f.name) },
                    ])
                  }
                  {...folderDropProps(f)}
                >
                  {isCollapsed ? <ChevronRight className="icon-sm" /> : <ChevronDown className="icon-sm" />}
                  <Folder className="icon-sm icon" />
                  <span className="flex-1">{f.name}</span>
                  <span className="ui-text-2xs text-muted">{conns.length}</span>
                </div>
                {!isCollapsed && (
                  <div className="connection-folder-body">
                    {conns.length === 0 ? (
                      <div className="connection-folder-empty ui-text-xs text-muted">{t('sidebar.folderEmpty')}</div>
                    ) : (
                      conns.map(renderConnection)
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
    </>
  );
}
