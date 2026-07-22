import { subscribeLanguageChanged, t } from '@/i18n';

// Static suggestion/hover copy, resolved once per language instead of per item
// (completion emits hundreds of items per keystroke).
export interface SqlLabels {
  pk: string;
  fk: string;
  notNull: string;
  table: string;
  view: string;
  schema: string;
  cte: string;
  subquery: string;
  column: string;
  type: string;
  foreignKey: string;
  cteColumn: string;
  subqueryColumn: string;
}

let cached: SqlLabels | null = null;

subscribeLanguageChanged(() => {
  cached = null;
});

export function sqlLabels(): SqlLabels {
  cached ??= {
    pk: t('editor.sql.pk'),
    fk: t('editor.sql.fk'),
    notNull: t('editor.sql.notNull'),
    table: t('editor.sql.table'),
    view: t('editor.sql.view'),
    schema: t('editor.sql.schema'),
    cte: t('editor.sql.cte'),
    subquery: t('editor.sql.subquery'),
    column: t('editor.sql.column'),
    type: t('editor.sql.type'),
    foreignKey: t('editor.sql.foreignKey'),
    cteColumn: t('editor.sql.cteColumn'),
    subqueryColumn: t('editor.sql.subqueryColumn'),
  };
  return cached;
}
