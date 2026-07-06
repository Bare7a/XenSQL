import { Application, Window } from '@wailsio/runtime';
import { ChevronRight, Minus, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import xensqlIcon from '@/assets/images/xensql-icon.png';
import { type EditAction, runEditAction } from '@/features/layout/lib/editActions';
import { ViewMenuContent } from '@/features/layout/ViewMenuContent';
import { isMac } from '@/shared/lib/platform';
import { formatBinding, getEffectiveBinding, type KeyBinding } from '@/shared/lib/shortcuts';

export type AppMenuAction = 'about' | 'shortcuts' | 'tips' | 'newTab' | 'closeTab' | 'reopenClosedTab' | 'quickSearch';

const HELP_ITEMS: { id: AppMenuAction; labelKey: string }[] = [
  { id: 'tips', labelKey: 'menu.keyboardTips' },
  { id: 'shortcuts', labelKey: 'menu.keyboardShortcuts' },
  { id: 'about', labelKey: 'menu.about' },
];

type FileMenuRow =
  | { id: AppMenuAction | 'exit'; labelKey: string; bindingId?: string; macHidden?: true }
  | { separator: true; id: string; macHidden?: true };

const FILE_MENU_ROWS: FileMenuRow[] = [
  { id: 'newTab', labelKey: 'menu.newTab', bindingId: 'newTab' },
  { id: 'closeTab', labelKey: 'menu.closeTab', bindingId: 'closeTab' },
  { id: 'reopenClosedTab', labelKey: 'menu.reopenClosedTab', bindingId: 'reopenClosedTab' },
  { separator: true, id: 'file-sep-1' },
  { id: 'quickSearch', labelKey: 'menu.quickSearch', bindingId: 'quickSearch' },
  { separator: true, id: 'file-sep-2', macHidden: true },
  { id: 'exit', labelKey: 'menu.exit', macHidden: true },
];

type EditMenuRow = { id: EditAction; labelKey: string; binding: KeyBinding } | { separator: true; id: string };

const EDIT_MENU_ROWS: EditMenuRow[] = [
  { id: 'undo', labelKey: 'editor.contextUndo', binding: { key: 'z', ctrl: true } },
  { id: 'redo', labelKey: 'editor.contextRedo', binding: { key: 'z', ctrl: true, shift: true } },
  { separator: true, id: 'edit-sep-1' },
  { id: 'cut', labelKey: 'editor.contextCut', binding: { key: 'x', ctrl: true } },
  { id: 'copy', labelKey: 'editor.contextCopy', binding: { key: 'c', ctrl: true } },
  { id: 'paste', labelKey: 'editor.contextPaste', binding: { key: 'v', ctrl: true } },
  { id: 'selectAll', labelKey: 'editor.contextSelectAll', binding: { key: 'a', ctrl: true } },
];

type MenuId = 'file' | 'edit' | 'view' | 'help';

type MenuRow =
  | { key: string; separator: true }
  | { key: string; label: string; shortcut?: string; onSelect: () => void; keepFocus?: boolean };

// Delay before hover switches an already-open flyout, so a diagonal pointer path
// from a row into its flyout can cross sibling rows without losing the target.
const SUB_SWITCH_DELAY_MS = 50;

interface Props {
  onAction: (action: AppMenuAction) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  jsonPanelOpen: boolean;
  onToggleJsonPanel: () => void;
}

export function AppTitleBar({ onAction, sidebarOpen, onToggleSidebar, jsonPanelOpen, onToggleJsonPanel }: Props) {
  const { t } = useTranslation();
  // Windows/Linux: the open top-level menu. macOS: 'app' = icon menu open, a MenuId = its flyout showing.
  const [open, setOpen] = useState<MenuId | 'app' | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const subSwitchTimer = useRef<number | null>(null);

  const cancelSubSwitch = () => {
    if (subSwitchTimer.current !== null) {
      window.clearTimeout(subSwitchTimer.current);
      subSwitchTimer.current = null;
    }
  };

  const closeAll = () => {
    cancelSubSwitch();
    setOpen(null);
  };

  const hoverSub = (id: MenuId) => {
    cancelSubSwitch();
    if (open === id) return;
    if (open === 'app') {
      setOpen(id);
      return;
    }
    subSwitchTimer.current = window.setTimeout(() => setOpen(id), SUB_SWITCH_DELAY_MS);
  };

  const onTitleBarDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, [role="menu"]')) return;
    Window.ToggleMaximise();
  };

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (barRef.current?.contains(e.target as Node)) return;
      closeAll();
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(
    () => () => {
      if (subSwitchTimer.current !== null) window.clearTimeout(subSwitchTimer.current);
    },
    [],
  );

  const renderRows = (rows: MenuRow[]) =>
    rows.map((row) =>
      'separator' in row ? (
        <div key={row.key} className="app-title-bar-dropdown-separator" />
      ) : (
        <button
          key={row.key}
          type="button"
          className="menu-check-row"
          role="menuitem"
          onMouseDown={row.keepFocus ? (e) => e.preventDefault() : undefined}
          onClick={() => {
            closeAll();
            row.onSelect();
          }}
        >
          <span className="menu-check-label">{row.label}</span>
          {row.shortcut && <span className="menu-check-shortcut">{row.shortcut}</span>}
        </button>
      ),
    );

  // Menu contents, shared by the Windows/Linux dropdowns and the macOS flyouts.
  const fileContent = renderRows(
    (isMac ? FILE_MENU_ROWS.filter((r) => !r.macHidden) : FILE_MENU_ROWS).map((row) =>
      'separator' in row
        ? { key: row.id, separator: true as const }
        : {
            key: row.id,
            label: t(row.labelKey),
            shortcut: row.bindingId ? formatBinding(getEffectiveBinding(row.bindingId)) : undefined,
            onSelect: () => {
              if (row.id === 'exit') {
                Application.Quit();
              } else {
                onAction(row.id);
              }
            },
          },
    ),
  );

  const editContent = renderRows(
    EDIT_MENU_ROWS.map((row) =>
      'separator' in row
        ? { key: row.id, separator: true as const }
        : {
            key: row.id,
            label: t(row.labelKey),
            shortcut: formatBinding(row.binding),
            onSelect: () => {
              void runEditAction(row.id);
            },
            keepFocus: true,
          },
    ),
  );

  const viewContent = (
    <ViewMenuContent
      sidebarOpen={sidebarOpen}
      onToggleSidebar={onToggleSidebar}
      jsonPanelOpen={jsonPanelOpen}
      onToggleJsonPanel={onToggleJsonPanel}
      onCloseMenu={closeAll}
    />
  );

  const helpContent = renderRows(
    HELP_ITEMS.map((item) => ({
      key: item.id,
      label: t(item.labelKey),
      onSelect: () => onAction(item.id),
    })),
  );

  const MENUS: { id: MenuId; labelKey: string; content: React.ReactNode }[] = [
    { id: 'file', labelKey: 'menu.file', content: fileContent },
    { id: 'edit', labelKey: 'menu.edit', content: editContent },
    { id: 'view', labelKey: 'menu.view', content: viewContent },
    { id: 'help', labelKey: 'menu.help', content: helpContent },
  ];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: OS-style window title bar; double-click-to-maximize mirrors native window chrome and is also available via the window-control buttons.
    <div ref={barRef} className="app-title-bar app-title-bar-drag" onDoubleClick={onTitleBarDoubleClick}>
      <div className="app-title-bar-left">
        {isMac ? (
          <div className="app-title-bar-menu">
            <button
              type="button"
              className={`app-title-bar-menu-trigger app-title-bar-menu-icon${open ? ' open' : ''}`}
              style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
              aria-haspopup="menu"
              aria-expanded={open !== null}
              onClick={() => (open ? closeAll() : setOpen('app'))}
            >
              <img src={xensqlIcon} alt="" className="app-title-bar-logo" />
              <span className="app-title-bar-menu-name">XenSQL</span>
            </button>
            {open && (
              <div className="app-title-bar-dropdown app-title-bar-menu-vertical" role="menu">
                {MENUS.map((m) => (
                  <div key={m.id} className="app-title-bar-submenu">
                    <button
                      type="button"
                      className={`app-title-bar-submenu-row${open === m.id ? ' open' : ''}`}
                      role="menuitem"
                      aria-haspopup="menu"
                      aria-expanded={open === m.id}
                      onMouseEnter={() => hoverSub(m.id)}
                      onClick={() => {
                        cancelSubSwitch();
                        setOpen(m.id);
                      }}
                    >
                      <span>{t(m.labelKey)}</span>
                      <ChevronRight className="icon-2xs app-title-bar-submenu-caret" strokeWidth={2} />
                    </button>
                    {open === m.id && (
                      <div
                        className="app-title-bar-dropdown app-title-bar-flyout"
                        role="menu"
                        onMouseEnter={cancelSubSwitch}
                      >
                        {m.content}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            <img src={xensqlIcon} alt="XenSQL" className="app-title-bar-logo" />
            {MENUS.map((m) => (
              <div key={m.id} className="app-title-bar-menu">
                <button
                  type="button"
                  className={`app-title-bar-menu-trigger${open === m.id ? ' open' : ''}`}
                  style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
                  aria-haspopup="menu"
                  aria-expanded={open === m.id}
                  onMouseEnter={() => {
                    if (open) setOpen(m.id);
                  }}
                  onClick={() => setOpen((cur) => (cur === m.id ? null : m.id))}
                >
                  {t(m.labelKey)}
                </button>
                {open === m.id && (
                  <div className="app-title-bar-dropdown" role="menu">
                    {m.content}
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
      {!isMac && (
        <div className="app-title-bar-controls">
          <button
            type="button"
            className="app-title-bar-winbtn"
            data-tooltip={t('window.minimize')}
            aria-label={t('window.minimize')}
            onClick={() => Window.Minimise()}
          >
            <Minus className="icon-sm" strokeWidth={2} />
          </button>
          <button
            type="button"
            className="app-title-bar-winbtn"
            data-tooltip={t('window.maximize')}
            aria-label={t('window.maximize')}
            onClick={() => Window.ToggleMaximise()}
          >
            <Square className="icon-xs" strokeWidth={2} />
          </button>
          <button
            type="button"
            className="app-title-bar-winbtn app-title-bar-winbtn-close"
            data-tooltip={t('window.close')}
            aria-label={t('window.close')}
            onClick={() => Application.Quit()}
          >
            <X className="icon-sm" strokeWidth={2} />
          </button>
        </div>
      )}
    </div>
  );
}
