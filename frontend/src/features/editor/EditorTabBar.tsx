import { Bookmark, Lock, Plus, Table2, X } from 'lucide-react';
import { forwardRef, memo } from 'react';
import { useTranslation } from 'react-i18next';
import { isSavedQueryTabDirty } from '@/features/editor/lib/savedQueryTab';
import { cx } from '@/shared/lib/cx';
import type { ConnectionConfig, EditorTab } from '@/types';

interface EditorTabBarProps {
  tabs: EditorTab[];
  activeTabId: string | null;
  connections: ConnectionConfig[];
  dragTabId: string | null;
  dropTabId: string | null;
  addTabBtnRef: React.RefObject<HTMLButtonElement | null>;
  onActivate: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onAddTab: () => void;
  onReorder: (fromId: string, toId: string) => void;
  onDragStart: (tabId: string) => void;
  onDragEnd: () => void;
  onDragOverTab: (tabId: string) => void;
  onDragLeaveTab: (tabId: string) => void;
}

// ref → scrollable wrapper; App attaches wheel-to-horizontal scroll and active-tab auto-scroll.
export const EditorTabBar = memo(
  forwardRef<HTMLDivElement, EditorTabBarProps>(function EditorTabBar(
    {
      tabs,
      activeTabId,
      connections,
      dragTabId,
      dropTabId,
      addTabBtnRef,
      onActivate,
      onClose,
      onAddTab,
      onReorder,
      onDragStart,
      onDragEnd,
      onDragOverTab,
      onDragLeaveTab,
    },
    ref,
  ) {
    const { t } = useTranslation();

    return (
      <div ref={ref} className="editor-tabs" role="tablist">
        {tabs.map((tab) => {
          const conn = connections.find((c) => c.id === tab.connectionId);
          const tabReadOnly = !!conn?.readOnly;
          const tabDirty = isSavedQueryTabDirty(tab);
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              role="tab"
              aria-selected={isActive}
              tabIndex={0}
              draggable
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onActivate(tab.id);
                }
              }}
              className={cx(
                'editor-tab',
                isActive && 'active',
                tabReadOnly && 'read-only-tab',
                dragTabId === tab.id && 'dragging',
                dropTabId === tab.id && 'drag-over',
              )}
              style={{ borderTopColor: isActive ? tab.color : 'transparent' }}
              onClick={() => onActivate(tab.id)}
              onDragStart={(e) => {
                onDragStart(tab.id);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', tab.id);
              }}
              onDragEnd={onDragEnd}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                if (dropTabId !== tab.id) onDragOverTab(tab.id);
              }}
              onDragLeave={() => onDragLeaveTab(tab.id)}
              onDrop={(e) => {
                e.preventDefault();
                const fromId = e.dataTransfer.getData('text/plain');
                if (fromId) onReorder(fromId, tab.id);
                onDragEnd();
              }}
              // Middle-click: mousedown for browsers that skip auxclick; auxclick for the modern path.
              onMouseDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(tab.id);
                }
              }}
              onAuxClick={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  onClose(tab.id);
                }
              }}
            >
              <span className="tab-color" style={{ background: tab.color }} />
              {tab.tableView && (
                <span className="tab-table-wrap" data-tooltip={t('tooltip.tableViewTab')}>
                  <Table2 className="icon-2xs tab-table-icon" strokeWidth={2.25} aria-hidden />
                </span>
              )}
              {tab.savedQueryId && (
                <span
                  className="tab-saved-wrap"
                  data-tooltip={tabDirty ? t('tooltip.savedQueryTabDirty') : t('tooltip.savedQueryTab')}
                >
                  <Bookmark
                    className={cx('icon-2xs', 'tab-saved-icon', tabDirty && 'tab-saved-icon-dirty')}
                    strokeWidth={2.25}
                    aria-hidden
                  />
                </span>
              )}
              {tabReadOnly && (
                <span className="tab-lock-wrap" data-tooltip={t('tooltip.readOnlyConnection')}>
                  <Lock
                    className={cx('icon-2xs', 'tab-lock')}
                    strokeWidth={2.25}
                    aria-label={t('tooltip.readOnlyConnection')}
                  />
                </span>
              )}
              <span className="tab-title">{tab.title}</span>
              <button
                type="button"
                className="close-btn"
                aria-label={t('menu.closeTab')}
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
              >
                <X className="icon-2xs" strokeWidth={2.25} aria-hidden />
              </button>
            </div>
          );
        })}
        <button
          ref={addTabBtnRef}
          type="button"
          className="btn btn-sm editor-tabs-add"
          aria-label={t('menu.newTab')}
          onClick={onAddTab}
        >
          <Plus className="icon-xs" aria-hidden />
        </button>
      </div>
    );
  }),
);
