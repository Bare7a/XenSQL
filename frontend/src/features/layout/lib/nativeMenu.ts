// Bridge to the native macOS menu bar (internal/appmenu): clicks arrive as
// MENU_ACTION_EVENT ids, item state goes back via MENU_SYNC_EVENT. Ids must
// match the Go builder.

import {
  DEFAULT_EDITOR_FONT_SIZE,
  decreaseEditorFontSize,
  increaseEditorFontSize,
  MAX_EDITOR_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE,
  resetEditorFontSize,
} from '@/features/editor/lib/editorFontSize';
import type { AppMenuAction } from '@/features/layout/AppTitleBar';
import { type AppLanguage, changeLanguage, SUPPORTED_LANGUAGES } from '@/i18n';
import { getEffectiveBinding, type KeyBinding } from '@/shared/lib/shortcuts';
import { type AppTheme, applyTheme } from '@/shared/lib/theme';
import {
  DEFAULT_UI_ZOOM_PX,
  MAX_UI_ZOOM_PX,
  MIN_UI_ZOOM_PX,
  resetUiZoom,
  zoomUiIn,
  zoomUiOut,
} from '@/shared/lib/uiZoom';

export const MENU_ACTION_EVENT = 'menu:action';
export const MENU_SYNC_EVENT = 'menu:sync';

export interface MenuItemState {
  id: string;
  label?: string;
  checked?: boolean;
  enabled?: boolean;
  accelerator?: string;
}

export interface NativeMenuHandlers {
  onAction: (action: AppMenuAction) => void;
  onToggleSidebar: () => void;
  onToggleJsonPanel: () => void;
}

const APP_MENU_ACTIONS: readonly AppMenuAction[] = [
  'about',
  'shortcuts',
  'tips',
  'newTab',
  'closeTab',
  'reopenClosedTab',
  'quickSearch',
];

export function runMenuAction(id: string, handlers: NativeMenuHandlers): void {
  if ((APP_MENU_ACTIONS as readonly string[]).includes(id)) {
    handlers.onAction(id as AppMenuAction);
    return;
  }
  if (id.startsWith('lang-')) {
    const code = id.slice('lang-'.length);
    if (SUPPORTED_LANGUAGES.some((lang) => lang.code === code)) changeLanguage(code as AppLanguage);
    return;
  }
  switch (id) {
    case 'helpAbout':
      handlers.onAction('about');
      break;
    case 'theme-dark':
      applyTheme('dark');
      break;
    case 'theme-light':
      applyTheme('light');
      break;
    case 'zoomIn':
      zoomUiIn();
      break;
    case 'zoomOut':
      zoomUiOut();
      break;
    case 'resetZoom':
      resetUiZoom();
      break;
    case 'increaseEditorFontSize':
      increaseEditorFontSize();
      break;
    case 'decreaseEditorFontSize':
      decreaseEditorFontSize();
      break;
    case 'resetEditorFontSize':
      resetEditorFontSize();
      break;
    case 'toggleSidebar':
      handlers.onToggleSidebar();
      break;
    case 'toggleJsonPanel':
      handlers.onToggleJsonPanel();
      break;
  }
}

// Wails accelerator syntax, parsed by pkg/application/keys.go.
export function bindingToAccelerator(binding: KeyBinding): string {
  const parts: string[] = [];
  if (binding.ctrl) parts.push('cmdorctrl');
  if (binding.alt) parts.push('alt');
  if (binding.shift) parts.push('shift');
  parts.push(binding.key.toLowerCase());
  return parts.join('+');
}

export interface MenuSyncInput {
  t: (key: string) => string;
  theme: AppTheme;
  language: AppLanguage;
  uiZoomPx: number;
  editorFontSize: number;
  sidebarOpen: boolean;
  jsonPanelOpen: boolean;
}

export function buildMenuSync(s: MenuSyncInput): MenuItemState[] {
  const accelerator = (id: string) => bindingToAccelerator(getEffectiveBinding(id));
  return [
    { id: 'about', label: s.t('menu.about') },
    { id: 'helpAbout', label: s.t('menu.about') },
    { id: 'newTab', label: s.t('menu.newTab'), accelerator: accelerator('newTab') },
    { id: 'closeTab', label: s.t('menu.closeTab'), accelerator: accelerator('closeTab') },
    { id: 'reopenClosedTab', label: s.t('menu.reopenClosedTab'), accelerator: accelerator('reopenClosedTab') },
    { id: 'quickSearch', label: s.t('menu.quickSearch'), accelerator: accelerator('quickSearch') },
    { id: 'theme-dark', label: s.t('theme.dark'), checked: s.theme === 'dark' },
    { id: 'theme-light', label: s.t('theme.light'), checked: s.theme === 'light' },
    ...SUPPORTED_LANGUAGES.map((lang) => ({ id: `lang-${lang.code}`, checked: s.language === lang.code })),
    {
      id: 'zoomIn',
      label: s.t('shortcuts.items.zoomIn'),
      accelerator: accelerator('zoomIn'),
      enabled: s.uiZoomPx < MAX_UI_ZOOM_PX,
    },
    {
      id: 'zoomOut',
      label: s.t('shortcuts.items.zoomOut'),
      accelerator: accelerator('zoomOut'),
      enabled: s.uiZoomPx > MIN_UI_ZOOM_PX,
    },
    {
      id: 'resetZoom',
      label: s.t('shortcuts.items.resetZoom'),
      accelerator: accelerator('resetZoom'),
      enabled: s.uiZoomPx !== DEFAULT_UI_ZOOM_PX,
    },
    {
      id: 'increaseEditorFontSize',
      label: s.t('editor.increaseFontSize'),
      accelerator: accelerator('increaseEditorFontSize'),
      enabled: s.editorFontSize < MAX_EDITOR_FONT_SIZE,
    },
    {
      id: 'decreaseEditorFontSize',
      label: s.t('editor.decreaseFontSize'),
      accelerator: accelerator('decreaseEditorFontSize'),
      enabled: s.editorFontSize > MIN_EDITOR_FONT_SIZE,
    },
    {
      id: 'resetEditorFontSize',
      label: s.t('editor.resetFontSize'),
      enabled: s.editorFontSize !== DEFAULT_EDITOR_FONT_SIZE,
    },
    {
      id: 'toggleSidebar',
      label: s.t('menu.toggleSidebar'),
      accelerator: accelerator('toggleSidebar'),
      checked: s.sidebarOpen,
    },
    {
      id: 'toggleJsonPanel',
      label: s.t('menu.toggleJsonPanel'),
      accelerator: accelerator('toggleJsonPanel'),
      checked: s.jsonPanelOpen,
    },
    { id: 'tips', label: s.t('menu.keyboardTips') },
    { id: 'shortcuts', label: s.t('menu.keyboardShortcuts') },
  ];
}
