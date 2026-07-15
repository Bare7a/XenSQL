import type { editor } from 'monaco-editor';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { format } from 'sql-formatter';
import type { ContextMenuItem } from '@/shared/components/ContextMenu';
import { api } from '@/shared/lib/api';
import { readClipboardText } from '@/shared/lib/clipboard';

export function useEditorContextMenu(
  editorRef: RefObject<editor.IStandaloneCodeEditor | null>,
  sql: string,
  onChange: (sql: string) => void,
): ContextMenuItem[] {
  const { t } = useTranslation();

  const formatQuery = () => {
    try {
      const formatted = format(sql, { language: 'sql', keywordCase: 'upper' });
      // Apply via the controlled value prop (executeEdits, preserves undo); setValue() would wipe undo.
      onChange(formatted);
    } catch {
      api.formatSQL(sql).then(onChange);
    }
  };

  const editorAction = (actionId: string) => () => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.focus();
    ed.trigger('ctx', actionId, null);
  };

  return [
    { label: t('editor.contextUndo'), action: editorAction('undo') },
    { label: t('editor.contextRedo'), action: editorAction('redo') },
    { label: '', action: () => {}, separator: true },
    { label: t('editor.contextCut'), action: editorAction('editor.action.clipboardCutAction') },
    { label: t('editor.contextCopy'), action: editorAction('editor.action.clipboardCopyAction') },
    {
      label: t('editor.contextPaste'),
      action: () => {
        const ed = editorRef.current;
        if (!ed) return;
        ed.focus();
        readClipboardText()
          .then((text) => {
            if (!text) return;
            ed.trigger('ctx', 'paste', { text });
          })
          .catch(() => {});
      },
    },
    { label: t('editor.contextDelete'), action: editorAction('deleteRight') },
    {
      label: t('editor.contextSelectAll'),
      action: editorAction('editor.action.selectAll'),
    },
    { label: '', action: () => {}, separator: true },
    { label: t('editor.contextFind'), action: editorAction('actions.find') },
    { label: t('editor.contextFindReplace'), action: editorAction('editor.action.startFindReplaceAction') },
    { label: t('editor.contextFormat'), action: formatQuery },
  ];
}
