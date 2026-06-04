import { type CSSProperties, type DragEventHandler } from 'react';
import { useTranslation } from 'react-i18next';
import { Edit2, Plug, Trash2, Unplug } from 'lucide-react';
import { cx } from '@/shared/lib/cx';
import { connectionSubtitle } from '@/shared/lib/connectionLabel';
import type { ConnectionConfig } from '@/types';

interface ConnectionDragProps {
  onDragStart: DragEventHandler;
  onDragEnd: DragEventHandler;
  onDragOver: DragEventHandler;
  onDragLeave: DragEventHandler;
  onDrop: DragEventHandler;
}

interface ConnectionItemProps {
  conn: ConnectionConfig;
  isSelected: boolean;
  isConnected: boolean;
  isDragging: boolean;
  isDropTarget: boolean;
  dragProps: ConnectionDragProps;
  onActivate: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ConnectionItem({
  conn,
  isSelected,
  isConnected,
  isDragging,
  isDropTarget,
  dragProps,
  onActivate,
  onContextMenu,
  onConnect,
  onDisconnect,
  onEdit,
  onDelete,
}: ConnectionItemProps) {
  const { t } = useTranslation();
  return (
    <div
      className={cx(
        'connection-item',
        isSelected && 'active',
        isDragging && 'dragging',
        isDropTarget && 'drag-over'
      )}
      style={{ '--conn-color': conn.color } as CSSProperties}
      tabIndex={0}
      data-nav-item
      draggable
      onClick={onActivate}
      onContextMenu={onContextMenu}
      {...dragProps}
    >
      <span
        className={cx('connection-status-dot', isConnected && 'is-connected')}
        data-tooltip={isConnected ? t('sidebar.connectedLabel') : t('sidebar.notConnected')}
      />
      <span className="connection-item-main">
        <span className="connection-item-name">{conn.name}</span>
        <span className="connection-item-sub">{connectionSubtitle(conn)}</span>
      </span>
      <span className="connection-item-hover-actions">
        <button
          type="button"
          className="btn btn-sm"
          data-tooltip={isConnected ? t('tooltip.disconnect') : t('tooltip.connect')}
          onClick={(e) => {
            e.stopPropagation();
            if (isConnected) onDisconnect();
            else onConnect();
          }}
        >
          {isConnected ? <Unplug className="icon-xs" /> : <Plug className="icon-xs" />}
        </button>
        <button
          type="button"
          className="btn btn-sm"
          data-tooltip={t('common.edit')}
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
        >
          <Edit2 className="icon-xs" />
        </button>
        <button
          type="button"
          className="btn btn-sm btn-danger"
          data-nav-delete
          data-tooltip={t('common.delete')}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
        >
          <Trash2 className="icon-xs" />
        </button>
      </span>
    </div>
  );
}
