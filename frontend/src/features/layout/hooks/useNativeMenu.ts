import { Events } from '@wailsio/runtime';
import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorFontSize } from '@/features/editor/hooks/useEditorFontSize';
import {
  buildMenuSync,
  MENU_ACTION_EVENT,
  MENU_SYNC_EVENT,
  type NativeMenuHandlers,
  runMenuAction,
} from '@/features/layout/lib/nativeMenu';
import { useAppLanguage } from '@/shared/hooks/useAppLanguage';
import { useAppTheme } from '@/shared/hooks/useAppTheme';
import { useUiZoom } from '@/shared/hooks/useUiZoom';
import { subscribeShortcutsChanged } from '@/shared/lib/shortcuts';

interface Props extends NativeMenuHandlers {
  enabled: boolean;
  sidebarOpen: boolean;
  jsonPanelOpen: boolean;
}

// Routes native macOS menu-bar clicks into the app and mirrors app state back into the menu.
export function useNativeMenu({
  enabled,
  sidebarOpen,
  jsonPanelOpen,
  onAction,
  onToggleSidebar,
  onToggleJsonPanel,
}: Props): void {
  const { t } = useTranslation();
  const theme = useAppTheme();
  const language = useAppLanguage();
  const uiZoomPx = useUiZoom();
  const editorFontSize = useEditorFontSize();

  // Latest handlers behind a ref so the click listener subscribes once.
  const handlersRef = useRef<NativeMenuHandlers>({ onAction, onToggleSidebar, onToggleJsonPanel });
  handlersRef.current = { onAction, onToggleSidebar, onToggleJsonPanel };

  useEffect(() => {
    if (!enabled) return;
    return Events.On(MENU_ACTION_EVENT, (e) => {
      runMenuAction(String(e.data), handlersRef.current);
    });
  }, [enabled]);

  const syncNow = useCallback(() => {
    void Events.Emit(
      MENU_SYNC_EVENT,
      buildMenuSync({ t, theme, language, uiZoomPx, editorFontSize, sidebarOpen, jsonPanelOpen }),
    );
  }, [t, theme, language, uiZoomPx, editorFontSize, sidebarOpen, jsonPanelOpen]);

  useEffect(() => {
    if (!enabled) return;
    syncNow();
    return subscribeShortcutsChanged(syncNow);
  }, [enabled, syncNow]);
}
