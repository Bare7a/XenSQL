import type { Monaco } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { type RefObject, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { parseSqlStatements, type SqlStatement } from '@/features/editor/lib/sqlStatements';

export function useRunGlyphs(
  editorRef: RefObject<editor.IStandaloneCodeEditor | null>,
  monacoRef: RefObject<Monaco | null>,
  sql: string,
  languageRevision: number,
) {
  const { t } = useTranslation();
  const runGlyphDecorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const statementsRef = useRef<SqlStatement[]>([]);

  const updateRunGlyphs = useCallback(
    (ed: editor.IStandaloneCodeEditor, monaco: Monaco, text: string) => {
      const statements = parseSqlStatements(text);
      statementsRef.current = statements;

      const decorations = statements.map((stmt) => ({
        range: new monaco.Range(stmt.runLine, 1, stmt.runLine, 1),
        options: {
          glyphMarginClassName: 'sql-statement-run-glyph',
          glyphMarginHoverMessage: { value: t('tooltip.runStatement') },
          stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
        },
      }));

      if (!runGlyphDecorationsRef.current) {
        runGlyphDecorationsRef.current = ed.createDecorationsCollection(decorations);
      } else {
        runGlyphDecorationsRef.current.set(decorations);
      }
    },
    [t],
  );

  useEffect(() => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco) return;
    updateRunGlyphs(ed, monaco, sql);
  }, [sql, updateRunGlyphs, languageRevision, editorRef, monacoRef]);

  return { updateRunGlyphs, statementsRef };
}
