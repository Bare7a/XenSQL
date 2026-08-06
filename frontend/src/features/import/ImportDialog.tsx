import { CircleAlert, CircleCheck, FileSpreadsheet, FileText, FolderOpen, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useImportRun } from '@/features/import/hooks/useImportRun';
import { Modal } from '@/shared/components/Modal';
import { api } from '@/shared/lib/api';
import { cx } from '@/shared/lib/cx';
import { formatError } from '@/shared/lib/normalize';
import {
  type CSVOptions,
  IMPORT_COLUMN_TYPES,
  type ImportColumnType,
  type ImportPreview,
  type TableInfo,
} from '@/types';

type ImportKind = 'csv' | 'sql';
type Target = 'existing' | 'new';

const DELIMITERS = [
  { value: '', labelKey: 'import.delimiterAuto' },
  { value: ',', labelKey: 'import.delimiterComma' },
  { value: ';', labelKey: 'import.delimiterSemicolon' },
  { value: '\\t', labelKey: 'import.delimiterTab' },
  { value: '|', labelKey: 'import.delimiterPipe' },
];

interface Props {
  connectionId: string;
  schema: string;
  tables: TableInfo[];
  initialTable?: string;
  onClose: () => void;
  onImported: () => void;
}

export function ImportDialog({ connectionId, schema, tables, initialTable, onClose, onImported }: Props) {
  const { t } = useTranslation();
  const [kind, setKind] = useState<ImportKind>('csv');
  const [path, setPath] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [previewing, setPreviewing] = useState(false);

  const [hasHeader, setHasHeader] = useState(true);
  const [delimiter, setDelimiter] = useState('');
  const [nullLiteral, setNullLiteral] = useState('');
  const [skipRows, setSkipRows] = useState(0);
  const [trimSpace, setTrimSpace] = useState(false);

  const [target, setTarget] = useState<Target>(initialTable ? 'existing' : 'new');
  const [existingTable, setExistingTable] = useState(initialTable ?? tables[0]?.name ?? '');
  const [newTable, setNewTable] = useState('');
  const [truncate, setTruncate] = useState(false);
  const [stopOnError, setStopOnError] = useState(false);

  const [mapping, setMapping] = useState<string[]>([]);
  const [columnTypes, setColumnTypes] = useState<ImportColumnType[]>([]);

  const { running, progress, result, error, startCSV, startSQL, cancel, reset } = useImportRun(connectionId);

  const csvOptions = useMemo<CSVOptions>(
    () => ({ hasHeader, delimiter, nullLiteral, skipRows, trimSpace }),
    [hasHeader, delimiter, nullLiteral, skipRows, trimSpace],
  );

  const loadPreview = useCallback(
    async (filePath: string, opts: CSVOptions) => {
      setPreviewing(true);
      setPreviewError('');
      try {
        const p = await api.previewImportFile(connectionId, filePath, opts);
        setPreview(p);
        setMapping(p.columns);
        setColumnTypes(p.inferredTypes);
        if (!newTable && p.columns.length) {
          const base = filePath.split(/[/\\]/).pop() ?? '';
          setNewTable(base.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_]/g, '_'));
        }
      } catch (err) {
        setPreview(null);
        setPreviewError(formatError(err));
      } finally {
        setPreviewing(false);
      }
    },
    [connectionId, newTable],
  );

  // So the sample matches what the import will actually see.
  useEffect(() => {
    if (kind !== 'csv' || !path) return;
    void loadPreview(path, csvOptions);
    // loadPreview changes with newTable, which must not re-trigger this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, path, csvOptions]);

  const pickFile = async () => {
    try {
      const picked = await api.pickImportFile(kind);
      if (!picked) return;
      reset();
      setPath(picked);
      if (kind === 'sql') setPreview(null);
    } catch {
      /* the dialog was dismissed */
    }
  };

  const targetTable = target === 'new' ? newTable.trim() : existingTable;
  const mappedCount = mapping.filter((m) => m.trim()).length;
  const canRun =
    !running &&
    !!path &&
    (kind === 'sql' || (!!preview && !!targetTable && mappedCount > 0)) &&
    (kind === 'sql' || target === 'new' || !!existingTable);

  const run = () => {
    if (kind === 'sql') {
      void startSQL({ path, stopOnError });
      return;
    }
    void startCSV({
      path,
      schema,
      table: targetTable,
      createTable: target === 'new',
      truncate: target === 'existing' && truncate,
      options: csvOptions,
      mapping,
      columnTypes,
      batchSize: 0,
      stopOnError,
    });
  };

  useEffect(() => {
    if (result && !result.cancelled && (result.inserted > 0 || result.statements > 0)) onImported();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const dismiss = () => {
    if (running) {
      cancel();
      return;
    }
    onClose();
  };

  const stopOnErrorCheck = (
    <div className="form-group form-group-checkbox">
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={stopOnError}
          onChange={(e) => setStopOnError(e.target.checked)}
          disabled={running}
        />
        <span className="checkbox-text">{t('import.stopOnError')}</span>
      </label>
    </div>
  );

  const setMappingAt = (i: number, value: string) =>
    setMapping((prev) => prev.map((m, idx) => (idx === i ? value : m)));
  const setTypeAt = (i: number, value: ImportColumnType) =>
    setColumnTypes((prev) => prev.map((c, idx) => (idx === i ? value : c)));

  return (
    <Modal title={t('import.title')} onClose={dismiss} size="lg">
      <div className="modal-body">
        <div className={cx(kind === 'csv' && 'form-row-fluid')}>
          <div className="form-group">
            <label htmlFor="import-kind-group">{t('import.kind')}</label>
            <div className="sidebar-toggle-group" id="import-kind-group" role="group" aria-label={t('import.kind')}>
              <button
                type="button"
                className={cx('btn btn-sm', kind === 'csv' && 'active')}
                onClick={() => {
                  setKind('csv');
                  setPath('');
                  setPreview(null);
                  reset();
                }}
                disabled={running}
              >
                <FileSpreadsheet className="icon-xs" /> {t('import.kindCSV')}
              </button>
              <button
                type="button"
                className={cx('btn btn-sm', kind === 'sql' && 'active')}
                onClick={() => {
                  setKind('sql');
                  setPath('');
                  setPreview(null);
                  reset();
                }}
                disabled={running}
              >
                <FileText className="icon-xs" /> {t('import.kindSQL')}
              </button>
            </div>
          </div>

          {kind === 'csv' && (
            <div className="form-group">
              <label htmlFor="import-target-group">{t('import.target')}</label>
              <div
                className="sidebar-toggle-group"
                id="import-target-group"
                role="group"
                aria-label={t('import.target')}
              >
                <button
                  type="button"
                  className={cx('btn btn-sm', target === 'new' && 'active')}
                  onClick={() => setTarget('new')}
                  disabled={running}
                >
                  {t('import.targetNew')}
                </button>
                <button
                  type="button"
                  className={cx('btn btn-sm', target === 'existing' && 'active')}
                  onClick={() => setTarget('existing')}
                  disabled={running || tables.length === 0}
                  data-tooltip={tables.length === 0 ? t('import.noTables') : undefined}
                >
                  {t('import.targetExisting')}
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="import-path">{t('import.file')}</label>
          <div className="form-file-row">
            <input id="import-path" type="text" value={path} readOnly placeholder={t('import.noFile')} />
            <button type="button" className="btn" onClick={() => void pickFile()} disabled={running}>
              <FolderOpen className="icon-xs" /> {t('common.browse')}
            </button>
          </div>
        </div>

        {kind === 'csv' && (
          <>
            {target === 'new' ? (
              <div className="form-group">
                <label htmlFor="import-newtable">{t('import.newTableName')}</label>
                <input
                  id="import-newtable"
                  type="text"
                  value={newTable}
                  onChange={(e) => setNewTable(e.target.value)}
                  disabled={running}
                />
                <p className="form-hint">{t('import.newTableHint')}</p>
              </div>
            ) : (
              <>
                <div className="form-group">
                  <label htmlFor="import-table">{t('import.existingTable')}</label>
                  <select
                    id="import-table"
                    value={existingTable}
                    onChange={(e) => setExistingTable(e.target.value)}
                    disabled={running}
                  >
                    {tables.map((tbl) => (
                      <option key={tbl.name} value={tbl.name}>
                        {tbl.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group form-group-checkbox">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={truncate}
                      onChange={(e) => setTruncate(e.target.checked)}
                      disabled={running}
                    />
                    <span className="checkbox-text">{t('import.truncate')}</span>
                  </label>
                  <p className="form-hint">{t('import.truncateHint')}</p>
                </div>
              </>
            )}

            <div className="form-section">
              <div className="form-row-fluid">
                <div className="form-group">
                  <label htmlFor="import-delimiter">{t('import.delimiter')}</label>
                  <select
                    id="import-delimiter"
                    value={delimiter}
                    onChange={(e) => setDelimiter(e.target.value)}
                    disabled={running}
                  >
                    {DELIMITERS.map((d) => (
                      <option key={d.value || 'auto'} value={d.value}>
                        {t(d.labelKey)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="import-skip">{t('import.skipRows')}</label>
                  <input
                    id="import-skip"
                    type="number"
                    min={0}
                    value={skipRows}
                    onChange={(e) => setSkipRows(Math.max(0, Number(e.target.value) || 0))}
                    disabled={running}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="import-null">{t('import.nullLiteral')}</label>
                  <input
                    id="import-null"
                    type="text"
                    value={nullLiteral}
                    placeholder={t('import.nullPlaceholder')}
                    onChange={(e) => setNullLiteral(e.target.value)}
                    disabled={running}
                  />
                </div>
              </div>

              <div className="form-row-fluid">
                <div className="form-group form-group-checkbox">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={hasHeader}
                      onChange={(e) => setHasHeader(e.target.checked)}
                      disabled={running}
                    />
                    <span className="checkbox-text">{t('import.hasHeader')}</span>
                  </label>
                </div>
                <div className="form-group form-group-checkbox">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={trimSpace}
                      onChange={(e) => setTrimSpace(e.target.checked)}
                      disabled={running}
                    />
                    <span className="checkbox-text">{t('import.trimSpace')}</span>
                  </label>
                </div>
                {stopOnErrorCheck}
              </div>
            </div>

            {previewing && (
              <p className="form-hint import-note">
                <Loader2 className="icon-xs spin" /> {t('import.reading')}
              </p>
            )}
            {previewError && (
              <div className="form-alert form-alert--error" role="alert">
                {previewError}
              </div>
            )}

            {preview && !previewing && (
              <div className="import-preview">
                <div className="import-preview-head">
                  <span>{t('import.columnsHeading')}</span>
                  <span className="text-muted ui-text-2xs">
                    {t('import.detectedDelimiter', { delimiter: displayDelimiter(preview.delimiter) })}
                  </span>
                </div>
                <div className="import-map-scroll">
                  <table className="import-map-table">
                    <thead>
                      <tr>
                        <th>{t('import.sourceColumn')}</th>
                        <th>{t('import.sample')}</th>
                        <th>{t('import.targetColumn')}</th>
                        {target === 'new' && <th>{t('import.columnType')}</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {preview.columns.map((col, i) => (
                        <tr key={col} className={cx(!mapping[i]?.trim() && 'import-row-skipped')}>
                          <td className="import-source-name">{col}</td>
                          <td className="import-sample">{preview.rows[0]?.[i] ?? ''}</td>
                          <td>
                            <input
                              type="text"
                              value={mapping[i] ?? ''}
                              placeholder={t('import.skipColumn')}
                              aria-label={t('import.targetColumnFor', { name: col })}
                              onChange={(e) => setMappingAt(i, e.target.value)}
                              disabled={running}
                            />
                          </td>
                          {target === 'new' && (
                            <td>
                              <select
                                value={columnTypes[i] ?? 'text'}
                                aria-label={t('import.columnTypeFor', { name: col })}
                                onChange={(e) => setTypeAt(i, e.target.value as ImportColumnType)}
                                disabled={running}
                              >
                                {IMPORT_COLUMN_TYPES.map((ct) => (
                                  <option key={ct} value={ct}>
                                    {t(`import.type.${ct}`)}
                                  </option>
                                ))}
                              </select>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {kind !== 'csv' && stopOnErrorCheck}

        {running && progress && (
          <div className="import-progress" aria-live="polite">
            <p className="text-muted">
              {kind === 'sql'
                ? t('import.progressStatements', { done: progress.processed, total: progress.totalBytes })
                : t('import.progressRows', { rows: progress.processed, inserted: progress.inserted })}
            </p>
            <progress
              className="export-progress-bar"
              value={kind === 'sql' ? progress.processed : progress.bytesRead}
              max={kind === 'sql' ? progress.totalBytes || 1 : progress.totalBytes || 1}
            />
          </div>
        )}

        {error && (
          <div className="form-alert form-alert--error" role="alert">
            {error}
          </div>
        )}

        {result && (
          <div className={cx('import-result', result.skipped > 0 && 'import-result--warn')} aria-live="polite">
            <p>
              {result.cancelled ? <CircleAlert className="icon-xs" /> : <CircleCheck className="icon-xs" />}{' '}
              {kind === 'sql'
                ? t('import.doneStatements', { count: result.statements, skipped: result.skipped })
                : t('import.doneRows', { count: result.inserted, skipped: result.skipped })}
            </p>
            {result.cancelled && <p className="text-muted ui-text-2xs">{t('import.cancelledNote')}</p>}
            {!!result.errors?.length && (
              <ul className="import-error-list">
                {result.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className="modal-footer">
        <button type="button" className="btn" onClick={dismiss}>
          {running ? t('import.stop') : t('common.close')}
        </button>
        <button type="button" className="btn btn-primary" onClick={run} disabled={!canRun}>
          {running ? t('import.running') : t('import.run')}
        </button>
      </div>
    </Modal>
  );
}

function displayDelimiter(d: string): string {
  return d === '\t' ? '\\t' : d;
}
