import { Application, Window } from '@wailsio/runtime';
import { Minus, Square, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import xensqlIcon from '@/assets/images/xensql-icon.png';
import { type EditAction, runEditAction } from '@/features/layout/lib/editActions';
import { ViewMenuContent } from '@/features/layout/ViewMenuContent';
import { formatBinding, getEffectiveBinding, type KeyBinding } from '@/shared/lib/shortcuts';

export type AppMenuAction = 'about' | 'shortcuts' | 'tips' | 'newTab' | 'closeTab' | 'quickSearch';

const HELP_ITEMS: { id: AppMenuAction; labelKey: string }[] = [
  { id: 'tips', labelKey: 'menu.keyboardTips' },
  { id: 'shortcuts', labelKey: 'menu.keyboardShortcuts' },
  { id: 'about', labelKey: 'menu.about' },
];

type FileMenuRow =
  | { id: AppMenuAction | 'exit'; labelKey: string; bindingId?: string }
  | { separator: true; id: string };

const FILE_MENU_ROWS: FileMenuRow[] = [
  { id: 'newTab', labelKey: 'menu.newTab', bindingId: 'newTab' },
  { id: 'closeTab', labelKey: 'menu.closeTab', bindingId: 'closeTab' },
  { separator: true, id: 'file-sep-1' },
  { id: 'quickSearch', labelKey: 'menu.quickSearch', bindingId: 'quickSearch' },
  { separator: true, id: 'file-sep-2' },
  { id: 'exit', labelKey: 'menu.exit' },
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

type OpenMenu = 'file' | 'edit' | 'view' | 'help' | null;

interface Props {
  onAction: (action: AppMenuAction) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  jsonPanelOpen: boolean;
  onToggleJsonPanel: () => void;
}

function TitleBarMenu({
  label,
  open,
  onToggle,
  children,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="app-title-bar-menu">
      <button
        type="button"
        className={`app-title-bar-menu-trigger${open ? ' open' : ''}`}
        style={{ '--wails-draggable': 'no-drag' } as React.CSSProperties}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
      >
        {label}
      </button>
      {open && (
        <div className="app-title-bar-dropdown" role="menu">
          {children}
        </div>
      )}
    </div>
  );
}

export function AppTitleBar({ onAction, sidebarOpen, onToggleSidebar, jsonPanelOpen, onToggleJsonPanel }: Props) {
  const { t } = useTranslation();
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const onTitleBarDoubleClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    Window.ToggleMaximise();
  };

  useEffect(() => {
    if (!openMenu) return;
    const close = (e: MouseEvent) => {
      if (barRef.current?.contains(e.target as Node)) return;
      setOpenMenu(null);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [openMenu]);

  const toggleMenu = (menu: OpenMenu) => {
    setOpenMenu((current) => (current === menu ? null : menu));
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: OS-style window title bar; double-click-to-maximize mirrors native window chrome and is also available via the window-control buttons.
    <div ref={barRef} className="app-title-bar app-title-bar-drag" onDoubleClick={onTitleBarDoubleClick}>
      <div className="app-title-bar-left">
        <img src={xensqlIcon} alt="XenSQL" className="app-title-bar-logo" />
        <TitleBarMenu label={t('menu.file')} open={openMenu === 'file'} onToggle={() => toggleMenu('file')}>
          {FILE_MENU_ROWS.map((row) =>
            'separator' in row ? (
              <div key={row.id} className="app-title-bar-dropdown-separator" />
            ) : (
              <button
                key={row.id}
                type="button"
                className="menu-check-row"
                role="menuitem"
                onClick={() => {
                  setOpenMenu(null);
                  if (row.id === 'exit') {
                    Application.Quit();
                  } else {
                    onAction(row.id);
                  }
                }}
              >
                <span className="menu-check-label">{t(row.labelKey)}</span>
                {row.bindingId && (
                  <span className="menu-check-shortcut">{formatBinding(getEffectiveBinding(row.bindingId))}</span>
                )}
              </button>
            ),
          )}
        </TitleBarMenu>
        <TitleBarMenu label={t('menu.edit')} open={openMenu === 'edit'} onToggle={() => toggleMenu('edit')}>
          {EDIT_MENU_ROWS.map((row) =>
            'separator' in row ? (
              <div key={row.id} className="app-title-bar-dropdown-separator" />
            ) : (
              <button
                key={row.id}
                type="button"
                className="menu-check-row"
                role="menuitem"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  setOpenMenu(null);
                  void runEditAction(row.id);
                }}
              >
                <span className="menu-check-label">{t(row.labelKey)}</span>
                <span className="menu-check-shortcut">{formatBinding(row.binding)}</span>
              </button>
            ),
          )}
        </TitleBarMenu>
        <TitleBarMenu label={t('menu.view')} open={openMenu === 'view'} onToggle={() => toggleMenu('view')}>
          <ViewMenuContent
            sidebarOpen={sidebarOpen}
            onToggleSidebar={onToggleSidebar}
            jsonPanelOpen={jsonPanelOpen}
            onToggleJsonPanel={onToggleJsonPanel}
            onCloseMenu={() => setOpenMenu(null)}
          />
        </TitleBarMenu>
        <TitleBarMenu label={t('menu.help')} open={openMenu === 'help'} onToggle={() => toggleMenu('help')}>
          {HELP_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className="app-title-bar-dropdown-item"
              role="menuitem"
              onClick={() => {
                setOpenMenu(null);
                onAction(item.id);
              }}
            >
              {t(item.labelKey)}
            </button>
          ))}
        </TitleBarMenu>
      </div>
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
    </div>
  );
}
