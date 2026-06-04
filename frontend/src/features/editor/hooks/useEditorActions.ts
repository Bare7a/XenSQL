import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { useTranslation } from 'react-i18next';
import { getEffectiveBinding, toMonacoKeybinding } from '@/shared/lib/shortcuts';
import { decreaseEditorFontSize, increaseEditorFontSize } from '@/features/editor/lib/editorFontSize';

interface UseEditorActionsArgs {
  editorRef: RefObject<editor.IStandaloneCodeEditor | null>;
  monacoRef: RefObject<Monaco | null>;
  isActive: boolean;
  runQuery: (selectedOnly: boolean) => void;
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
  onSaveQueryRef,
  onRenameSavedQueryRef,
  shortcutRevision,
  languageRevision,
}: UseEditorActionsArgs) {
  const { t } = useTranslation();
  const editorActionsRef = useRef<{ dispose: () => void }[]>([]);

  const bindEditorActions = useCallback(
    (ed: editor.IStandaloneCodeEditor, monaco: Monaco) => {
      editorActionsRef.current.forEach((d) => d.dispose());
      editorActionsRef.current = [
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
    },
    [runQuery, t, onSaveQueryRef, onRenameSavedQueryRef]
  );

  useEffect(() => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco || !isActive) return;
    bindEditorActions(ed, monaco);
  }, [isActive, bindEditorActions, shortcutRevision, languageRevision, editorRef, monacoRef]);

  return { bindEditorActions };
}
