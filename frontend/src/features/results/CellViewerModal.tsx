import Editor from '@monaco-editor/react';
import { AlignLeft, Ban, ChevronsDownUp, ChevronsUpDown, Copy, Minimize2 } from 'lucide-react';
import type { editor } from 'monaco-editor';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorFontSize } from '@/features/editor/hooks/useEditorFontSize';
import { monacoFontOptions } from '@/features/editor/lib/editorFontSize';
import { getMonacoThemeName, setupMonacoBeforeMount } from '@/features/editor/lib/monacoTheme';
import {
  applyContentFormat,
  type ContentKind,
  dropdownKind,
  initialContent,
  isStructuredKind,
  kindLabelKey,
  monacoLanguageForKind,
  SELECTABLE_KINDS,
} from '@/features/results/lib/cellContentFormat';
import { Modal } from '@/shared/components/Modal';
import { useAppTheme } from '@/shared/hooks/useAppTheme';
import { useMeasuredHeight } from '@/shared/hooks/useMeasuredHeight';
import { api } from '@/shared/lib/api';
import { appToast } from '@/shared/lib/appToast';

interface Props {
  column: string;
  value: string;
  isNull: boolean;
  onClose: () => void;
  onSave?: (value: string) => void;
  /** When provided (editable table-view only), shows a button that sets the cell to SQL NULL. */
  onSetNull?: () => void;
  startInEditMode?: boolean;
}

const MONACO_BASE: editor.IStandaloneEditorConstructionOptions = {
  fontFamily: 'JetBrains Mono, Consolas, monospace',
  minimap: { enabled: false },
  wordWrap: 'on',
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  lineNumbers: 'on',
  renderLineHighlight: 'line',
  padding: { top: 8, bottom: 8 },
  scrollbar: {
    verticalScrollbarSize: 11,
    horizontalScrollbarSize: 11,
  },
};

export function CellViewerModal({ column, value, isNull, onClose, onSave, onSetNull, startInEditMode = false }: Props) {
  const { t } = useTranslation();
  const appTheme = useAppTheme();
  const monacoTheme = getMonacoThemeName(appTheme);
  const fontSize = useEditorFontSize();
  const initial = useMemo(() => initialContent(value, isNull), [value, isNull]);
  const [content, setContent] = useState(initial.text);
  const [kind, setKind] = useState<ContentKind>(initial.kind);
  const [editMode, setEditMode] = useState(startInEditMode);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [lineCount, setLineCount] = useState(1);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const [bodyRef, editorHeight] = useMeasuredHeight<HTMLDivElement>(320);

  const structured = isStructuredKind(kind);
  const monacoLanguage = monacoLanguageForKind(kind);
  const readOnly = Boolean(onSave && !editMode && !isNull);

  const editorOptions = useMemo(
    (): editor.IStandaloneEditorConstructionOptions => ({
      ...MONACO_BASE,
      ...monacoFontOptions(fontSize),
      readOnly: readOnly || isNull,
      folding: structured,
      showFoldingControls: structured ? 'always' : 'never',
      foldingHighlight: structured,
      bracketPairColorization: { enabled: structured },
      guides: structured ? { indentation: true, bracketPairs: true } : { indentation: true },
    }),
    [structured, readOnly, isNull, fontSize],
  );

  useEffect(() => {
    editorRef.current?.updateOptions(monacoFontOptions(fontSize));
  }, [fontSize]);

  useEffect(() => {
    const next = initialContent(value, isNull);
    setContent(next.text);
    setKind(next.kind);
    setEditMode(startInEditMode);
    setFormatError(null);
  }, [value, isNull, column, startInEditMode]);

  const syncLineCount = useCallback((ed: editor.IStandaloneCodeEditor) => {
    setLineCount(ed.getModel()?.getLineCount() ?? 1);
  }, []);

  const handleEditorMount = (ed: editor.IStandaloneCodeEditor) => {
    editorRef.current = ed;
    syncLineCount(ed);
    ed.onDidChangeModelContent(() => syncLineCount(ed));
    // Monaco mounts after Modal's initial focus - move focus into the editor.
    requestAnimationFrame(() => {
      ed.focus();
    });
  };

  const runFoldAction = (actionId: 'editor.foldAll' | 'editor.unfoldAll') => {
    editorRef.current?.getAction(actionId)?.run();
  };

  const applyFormat = (mode: 'beautify' | 'minify') => {
    setFormatError(null);
    try {
      const { text, kind: nextKind } = applyContentFormat(content, kind, mode);
      setContent(text);
      setKind(nextKind);
      editorRef.current?.setValue(text);
      if (onSave) setEditMode(true);
    } catch {
      setFormatError(mode === 'beautify' ? t('cellViewer.beautifyError') : t('cellViewer.minifyError'));
    }
  };

  const copy = async () => {
    const text = editorRef.current?.getValue() ?? content;
    await api.copyToClipboard(text);
    appToast.success(t('toast.copiedClipboard'));
  };

  const kindLabel = (k: ContentKind) => t(kindLabelKey(k));
  const selectedKind = dropdownKind(kind);

  const changeKind = (next: ContentKind) => {
    setKind(next);
    setFormatError(null);
  };

  const canEdit = Boolean(onSave && !isNull);
  const handleSave = () => {
    const text = editorRef.current?.getValue() ?? content;
    onSave?.(text);
    onClose();
  };

  return (
    <Modal
      title={column}
      onClose={onClose}
      size="xl"
      className="cell-viewer-modal"
      headerExtra={
        isNull ? (
          <span className="cell-viewer-hint">{kindLabel('null')}</span>
        ) : (
          <span className="cell-viewer-lines">
            {lineCount} {lineCount === 1 ? t('cellViewer.line') : t('cellViewer.lines')}
          </span>
        )
      }
    >
      <div ref={bodyRef} className="modal-body cell-viewer-body">
        <div className="cell-viewer-monaco">
          <Editor
            height={editorHeight}
            language={monacoLanguage}
            theme={monacoTheme}
            value={content}
            loading={<div className="monaco-editor-placeholder" aria-hidden />}
            onChange={(v) => {
              const next = v ?? '';
              setContent(next);
              if (onSave) setEditMode(true);
              setFormatError(null);
            }}
            beforeMount={setupMonacoBeforeMount}
            onMount={handleEditorMount}
            options={editorOptions}
          />
        </div>
      </div>
      {formatError && <p className="form-alert form-alert--error">{formatError}</p>}
      <div className="modal-footer cell-viewer-footer">
        <div className="cell-viewer-footer-left">
          {!isNull && (
            <select
              className="cell-viewer-kind-select"
              value={selectedKind}
              onChange={(e) => changeKind(e.target.value as ContentKind)}
              aria-label={t('cellViewer.kindLabel')}
              data-tooltip={t('tooltip.cellViewerKind')}
            >
              {SELECTABLE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {kindLabel(k)}
                </option>
              ))}
            </select>
          )}
          {structured && (
            <>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => runFoldAction('editor.foldAll')}
                data-tooltip={t('tooltip.collapseFolds')}
              >
                <ChevronsUpDown className="icon-xs" /> {t('cellViewer.foldAll')}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => runFoldAction('editor.unfoldAll')}
                data-tooltip={t('tooltip.expandFolds')}
              >
                <ChevronsDownUp className="icon-xs" /> {t('cellViewer.unfoldAll')}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => applyFormat('beautify')}
                data-tooltip={t('tooltip.prettify')}
              >
                <AlignLeft className="icon-xs" /> {t('cellViewer.beautify')}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => applyFormat('minify')}
                data-tooltip={t('tooltip.minify')}
              >
                <Minimize2 className="icon-xs" /> {t('cellViewer.minify')}
              </button>
            </>
          )}
          <button type="button" className="btn btn-sm" onClick={() => void copy()}>
            <Copy className="icon-xs" /> {t('common.copy')}
          </button>
        </div>
        <div className="cell-viewer-footer-right">
          {onSetNull && !isNull && (
            <button type="button" className="btn btn-sm btn-danger" onClick={onSetNull}>
              <Ban className="icon-xs" /> {t('cellViewer.setNull')}
            </button>
          )}
          {canEdit && editMode ? (
            <>
              <button type="button" className="btn btn-sm" onClick={onClose}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={handleSave}>
                {t('common.save')}
              </button>
            </>
          ) : canEdit ? (
            <>
              <button type="button" className="btn btn-sm" onClick={onClose}>
                {t('common.close')}
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setEditMode(true)}>
                {t('cellViewer.editValue')}
              </button>
            </>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
              {t('common.close')}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
