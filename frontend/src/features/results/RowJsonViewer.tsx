import Editor from '@monaco-editor/react';
import { Search, X } from 'lucide-react';
import type { editor } from 'monaco-editor';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorFontSize } from '@/features/editor/hooks/useEditorFontSize';
import { monacoFontOptions } from '@/features/editor/lib/editorFontSize';
import { getMonacoThemeName, setupMonacoBeforeMount } from '@/features/editor/lib/monacoTheme';
import { useAppTheme } from '@/shared/hooks/useAppTheme';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';
import { filterJsonForViewer } from '@/shared/lib/rowJson';
import { formatBinding, getEffectiveBinding } from '@/shared/lib/shortcuts';

interface Props {
  data: Record<string, unknown> | null;
  onClose: () => void;
}

const EDITOR_OPTS_BASE = {
  readOnly: true,
  fontFamily: 'JetBrains Mono, Consolas, monospace',
  minimap: { enabled: false },
  contextmenu: false,
  wordWrap: 'on' as const,
  scrollBeyondLastLine: false,
  automaticLayout: true,
  lineNumbers: 'off' as const,
  folding: true,
  renderLineHighlight: 'none' as const,
  fixedOverflowWidgets: true,
  find: { addExtraSpaceOnTop: false },
  padding: { top: 8, bottom: 8 },
  scrollbar: {
    verticalScrollbarSize: 10,
    horizontalScrollbarSize: 10,
  },
};

export function RowJsonViewer({ data, onClose }: Props) {
  const { t } = useTranslation();
  const appTheme = useAppTheme();
  const monacoTheme = getMonacoThemeName(appTheme);
  const fontSize = useEditorFontSize();
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [filter, setFilter] = useState('');
  // Debounce filter to avoid JSON.stringify/Monaco work per keystroke.
  const debouncedFilter = useDebouncedValue(filter, 150);

  const editorOptions = useMemo(
    () => ({
      ...EDITOR_OPTS_BASE,
      ...monacoFontOptions(fontSize),
    }),
    [fontSize],
  );

  useEffect(() => {
    editorRef.current?.updateOptions(monacoFontOptions(fontSize));
  }, [fontSize]);

  // Clear ref when data is null so the font-size effect can't poke a disposed Monaco instance.
  useEffect(() => {
    if (!data) editorRef.current = null;
  }, [data]);

  const jsonText = useMemo(() => {
    if (!data) return t('jsonViewer.emptySelectRow');
    const filtered = filterJsonForViewer(data, debouncedFilter);
    if (filtered == null) return t('jsonViewer.noMatch');
    try {
      return JSON.stringify(filtered, null, 2);
    } catch {
      return t('jsonViewer.serializeError');
    }
  }, [data, debouncedFilter, t]);

  const closeLabel = t('tooltip.closeJsonViewer', {
    shortcut: formatBinding(getEffectiveBinding('toggleJsonPanel')),
  });

  return (
    <aside className="json-viewer-panel" aria-label={t('jsonViewer.title')}>
      <div className="json-viewer-inner">
        <div className="json-viewer-header">
          <span className="json-viewer-title">{t('jsonViewer.title')}</span>
          <button
            type="button"
            className="json-viewer-close"
            onClick={onClose}
            aria-label={closeLabel}
            data-tooltip={closeLabel}
          >
            <X className="icon-sm" />
          </button>
        </div>
        {data ? (
          <>
            <div className="json-viewer-filter">
              <Search className="icon-sm json-viewer-filter-icon" aria-hidden />
              <input
                type="text"
                className="json-viewer-filter-input"
                placeholder={t('jsonViewer.filterPlaceholder')}
                aria-label={t('jsonViewer.filterPlaceholder')}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            </div>
            <div className="json-viewer-editor">
              <Editor
                theme={monacoTheme}
                language="json"
                value={jsonText}
                beforeMount={setupMonacoBeforeMount}
                onMount={(ed) => {
                  editorRef.current = ed;
                }}
                options={editorOptions}
              />
            </div>
          </>
        ) : (
          <div className="empty-state">{t('jsonViewer.emptySelectRow')}</div>
        )}
      </div>
    </aside>
  );
}
