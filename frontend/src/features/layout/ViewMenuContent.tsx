import { WindowFullscreen, WindowIsFullscreen, WindowUnfullscreen } from '@wails/runtime/runtime';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_EDITOR_FONT_SIZE,
  decreaseEditorFontSize,
  getEffectiveEditorFontSize,
  increaseEditorFontSize,
  MAX_EDITOR_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE,
  resetEditorFontSize,
  subscribeEditorFontSizeChanged,
} from '@/features/editor/lib/editorFontSize';
import { MenuStepperRow } from '@/features/layout/MenuStepperRow';
import {
  type AppLanguage,
  changeLanguage,
  getEffectiveLanguage,
  SUPPORTED_LANGUAGES,
  subscribeLanguageChanged,
} from '@/i18n';
import { formatBinding, getEffectiveBinding } from '@/shared/lib/shortcuts';
import { type AppTheme, applyTheme, getEffectiveTheme, subscribeThemeChanged } from '@/shared/lib/theme';
import {
  DEFAULT_UI_ZOOM_PX,
  getEffectiveUiZoomPx,
  MAX_UI_ZOOM_PX,
  MIN_UI_ZOOM_PX,
  resetUiZoom,
  subscribeUiZoomChanged,
  zoomUiIn,
  zoomUiOut,
} from '@/shared/lib/uiZoom';

const THEME_LABELS: Record<AppTheme, string> = {
  dark: 'theme.dark',
  light: 'theme.light',
};

interface Props {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  jsonPanelOpen: boolean;
  onToggleJsonPanel: () => void;
  onCloseMenu: () => void;
}

export function ViewMenuContent({
  sidebarOpen,
  onToggleSidebar,
  jsonPanelOpen,
  onToggleJsonPanel,
  onCloseMenu,
}: Props) {
  const { t } = useTranslation();
  const [theme, setTheme] = useState<AppTheme>(() => getEffectiveTheme());
  const [language, setLanguage] = useState<AppLanguage>(() => getEffectiveLanguage());
  const [fontSize, setFontSize] = useState(() => getEffectiveEditorFontSize());
  const [uiZoomPx, setUiZoomPx] = useState(() => getEffectiveUiZoomPx());
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    void WindowIsFullscreen().then(setIsFullscreen);
  }, []);

  useEffect(() => subscribeThemeChanged(setTheme), []);
  useEffect(() => subscribeLanguageChanged(() => setLanguage(getEffectiveLanguage())), []);
  useEffect(() => subscribeEditorFontSizeChanged(setFontSize), []);
  useEffect(() => subscribeUiZoomChanged(setUiZoomPx), []);

  const toggleTheme = () => {
    applyTheme(theme === 'dark' ? 'light' : 'dark');
  };

  const pickLanguage = (next: AppLanguage) => {
    changeLanguage(next);
    document.documentElement.lang = next;
    onCloseMenu();
  };

  const handleToggleFullscreen = async () => {
    const isFs = await WindowIsFullscreen();
    if (isFs) {
      WindowUnfullscreen();
      setIsFullscreen(false);
    } else {
      WindowFullscreen();
      setIsFullscreen(true);
    }
    onCloseMenu();
  };

  return (
    <>
      {/* ── Appearance ── */}
      <div className="menu-section-header">{t('viewSections.appearance')}</div>

      <button
        type="button"
        className="menu-toggle-row"
        role="switch"
        aria-checked={theme === 'dark'}
        onClick={toggleTheme}
      >
        <span className="menu-toggle-label">{t('viewSections.theme')}</span>
        <span className="menu-toggle-value">{t(THEME_LABELS[theme])}</span>
        <span className={`menu-toggle-track${theme === 'dark' ? ' on' : ''}`}>
          <span className="menu-toggle-thumb" />
        </span>
      </button>

      <MenuStepperRow
        label={t('uiZoom.label')}
        value={`${Math.round((uiZoomPx / DEFAULT_UI_ZOOM_PX) * 100)}%`}
        decrementDisabled={uiZoomPx <= MIN_UI_ZOOM_PX}
        incrementDisabled={uiZoomPx >= MAX_UI_ZOOM_PX}
        resetDisabled={uiZoomPx === DEFAULT_UI_ZOOM_PX}
        decrementLabel={t('shortcuts.items.zoomOut')}
        incrementLabel={t('shortcuts.items.zoomIn')}
        resetLabel={t('shortcuts.items.resetZoom')}
        onDecrement={() => zoomUiOut()}
        onIncrement={() => zoomUiIn()}
        onReset={() => resetUiZoom()}
      />
      <MenuStepperRow
        label={t('editor.fontSize')}
        value={`${fontSize}px`}
        decrementDisabled={fontSize <= MIN_EDITOR_FONT_SIZE}
        incrementDisabled={fontSize >= MAX_EDITOR_FONT_SIZE}
        resetDisabled={fontSize === DEFAULT_EDITOR_FONT_SIZE}
        decrementLabel={t('editor.decreaseFontSize')}
        incrementLabel={t('editor.increaseFontSize')}
        resetLabel={t('editor.resetFontSize')}
        onDecrement={() => decreaseEditorFontSize()}
        onIncrement={() => increaseEditorFontSize()}
        onReset={() => resetEditorFontSize()}
      />

      {/* ── Language ── */}
      <div className="app-title-bar-dropdown-separator" />
      <div className="menu-section-header">{t('viewSections.language')}</div>
      {SUPPORTED_LANGUAGES.map((item) => (
        <button
          key={item.code}
          type="button"
          className="menu-check-row"
          role="menuitemradio"
          aria-checked={language === item.code}
          onClick={() => pickLanguage(item.code)}
        >
          <span className="menu-check-label">{item.nativeName}</span>
          {language === item.code && <span className="menu-check-icon">✓</span>}
        </button>
      ))}

      {/* ── Window ── */}
      <div className="app-title-bar-dropdown-separator" />
      <div className="menu-section-header">{t('viewSections.window')}</div>
      <div className="menu-window-spacer" />
      <button
        type="button"
        className="menu-check-row"
        role="menuitemcheckbox"
        aria-checked={sidebarOpen}
        onClick={onToggleSidebar}
      >
        <span className="menu-check-label">{t('menu.toggleSidebar')}</span>
        <span className="menu-check-shortcut">{formatBinding(getEffectiveBinding('toggleSidebar'))}</span>
        {sidebarOpen && <span className="menu-check-icon">✓</span>}
      </button>
      <button
        type="button"
        className="menu-check-row"
        role="menuitemcheckbox"
        aria-checked={jsonPanelOpen}
        onClick={onToggleJsonPanel}
      >
        <span className="menu-check-label">{t('menu.toggleJsonPanel')}</span>
        <span className="menu-check-shortcut">{formatBinding(getEffectiveBinding('toggleJsonPanel'))}</span>
        {jsonPanelOpen && <span className="menu-check-icon">✓</span>}
      </button>
      <button
        type="button"
        className="menu-check-row"
        role="menuitemcheckbox"
        aria-checked={isFullscreen}
        onClick={() => void handleToggleFullscreen()}
      >
        <span className="menu-check-label">{t('menu.toggleFullscreen')}</span>
        <span className="menu-check-shortcut">{formatBinding(getEffectiveBinding('toggleFullscreen'))}</span>
        {isFullscreen && <span className="menu-check-icon">✓</span>}
      </button>
    </>
  );
}
