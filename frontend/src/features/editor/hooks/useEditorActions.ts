import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { type RefObject, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { decreaseEditorFontSize, increaseEditorFontSize } from '@/features/editor/lib/editorFontSize';
import { getEffectiveBinding, toMonacoKeybinding } from '@/shared/lib/shortcuts';

interface UseEditorActionsArgs {
  editorRef: RefObject<editor.IStandaloneCodeEditor | null>;
  monacoRef: RefObject<Monaco | null>;
  isActive: boolean;
  runQuery: (selectedOnly: boolean) => void;
  explainQuery: (analyze: boolean) => void;
  canAnalyze: boolean;
  onSaveQueryRef: RefObject<(() => void) | undefined>;
  onRenameSavedQueryRef: RefObject<(() => void) | undefined>;
  shortcutRevision: number;
  languageRevision: number;
}

export function useEditorActions({
  editorRef,
  monacoRef,
  isActive,
  runQuery,
  explainQuery,
  canAnalyze,
  onSaveQueryRef,
  onRenameSavedQueryRef,
  shortcutRevision,
  languageRevision,
}: UseEditorActionsArgs) {
  const { t } = useTranslation();
  const editorActionsRef = useRef<{ dispose: () => void }[]>([]);

  const bindEditorActions = useCallback(
    (ed: editor.IStandaloneCodeEditor, monaco: Monaco) => {
      for (const d of editorActionsRef.current) d.dispose();
      const actions = [
        ed.addAction({
          id: 'run-selected',
          label: t('editor.actionRunSelection'),
          keybindings: [toMonacoKeybinding(monaco, getEffectiveBinding('runSelection'))],
          run: () => runQuery(true),
        }),
        ed.addAction({
          id: 'run-query',
          label: t('editor.actionRunAll'),
          keybindings: [toMonacoKeybinding(monaco, getEffectiveBinding('runAll'))],
          run: () => runQuery(false),
        }),
        ed.addAction({
          id: 'explain-query',
          label: t('editor.actionExplain'),
          keybindings: [toMonacoKeybinding(monaco, getEffectiveBinding('explainQuery'))],
          run: () => explainQuery(false),
        }),
        ed.addAction({
          id: 'save-query',
          label: t('editor.actionSaveQuery'),
          keybindings: [toMonacoKeybinding(monaco, getEffectiveBinding('saveQuery'))],
          run: () => {
            onSaveQueryRef.current?.();
          },
        }),
        ed.addAction({
          id: 'rename-saved-query',
          label: t('editor.actionRenameSaved'),
          keybindings: [toMonacoKeybinding(monaco, getEffectiveBinding('renameSavedQuery'))],
          run: () => {
            onRenameSavedQueryRef.current?.();
          },
        }),
        ed.addAction({
          id: 'increase-editor-font-size',
          label: t('shortcuts.items.increaseEditorFontSize'),
          keybindings: [toMonacoKeybinding(monaco, getEffectiveBinding('increaseEditorFontSize'))],
          run: () => {
            increaseEditorFontSize();
          },
        }),
        ed.addAction({
          id: 'decrease-editor-font-size',
          label: t('shortcuts.items.decreaseEditorFontSize'),
          keybindings: [toMonacoKeybinding(monaco, getEffectiveBinding('decreaseEditorFontSize'))],
          run: () => {
            decreaseEditorFontSize();
          },
        }),
      ];
      // Left unbound where the engine cannot measure, so the key does nothing rather than error.
      if (canAnalyze) {
        actions.push(
          ed.addAction({
            id: 'explain-analyze',
            label: t('editor.actionExplainAnalyze'),
            keybindings: [toMonacoKeybinding(monaco, getEffectiveBinding('explainAnalyze'))],
            run: () => explainQuery(true),
          }),
        );
      }
      editorActionsRef.current = actions;
    },
    [runQuery, explainQuery, canAnalyze, t, onSaveQueryRef, onRenameSavedQueryRef],
  );

  useEffect(() => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco || !isActive) return;
    bindEditorActions(ed, monaco);
  }, [isActive, bindEditorActions, shortcutRevision, languageRevision, editorRef, monacoRef]);

  return { bindEditorActions };
}
