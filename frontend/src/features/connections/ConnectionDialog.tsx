import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/shared/components/Modal';
import { api } from '@/shared/lib/api';
import { appToast } from '@/shared/lib/appToast';
import type { ConnectionConfig, DriverType } from '@/types';
import { DEFAULT_COLORS, DEFAULT_CONNECTION_COLOR } from '@/types';
import { formatError } from '@/shared/lib/normalize';

interface Props {
  connection?: ConnectionConfig | null;
  onClose: () => void;
  onSaved: (c: ConnectionConfig) => void;
}

function isNetworkDriver(driver: DriverType): boolean {
  return driver === 'postgres' || driver === 'mysql';
}

function defaultsForDriver(driver: DriverType): Partial<ConnectionConfig> {
  if (driver === 'postgres') {
    return { port: 5432, username: 'postgres', schema: 'public', sslMode: 'disable' };
  }
  if (driver === 'mysql') {
    return { port: 3306, username: 'root', schema: '', sslMode: 'disable' };
  }
  return {};
}

export function ConnectionDialog({ connection, onClose, onSaved }: Props) {
  const { t } = useTranslation();
  const isEdit = !!connection?.id;
  const [form, setForm] = useState<ConnectionConfig>(
    connection || {
      id: '',
      name: '',
      driver: 'sqlite',
      color: DEFAULT_CONNECTION_COLOR,
      filePath: '',
      host: 'localhost',
      port: 5432,
      database: '',
      username: 'postgres',
      password: '',
      sslMode: 'disable',
      schema: 'public',
    }
  );
  const [error, setError] = useState('');
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const network = isNetworkDriver(form.driver);

  const update = (patch: Partial<ConnectionConfig>) => setForm((f) => ({ ...f, ...patch }));

  const handleDriverChange = (driver: DriverType) => {
    update({ driver, ...defaultsForDriver(driver) });
  };

  const handlePickFile = async () => {
    try {
      const path = await api.pickSQLiteFile();
      if (path) update({ filePath: path, name: form.name || path.split(/[/\\]/).pop() || 'SQLite' });
    } catch {
      /* cancelled */
    }
  };

  const handleTest = async () => {
    setTesting(true);
    try {
      await api.testConnection(form);
      appToast.success(t('toast.connectionSuccess'));
    } catch (e) {
      appToast.error(formatError(e));
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (saving) return;
    setError('');
    if (!form.name?.trim()) {
      setError(t('connection.nameRequired'));
      return;
    }
    if (form.driver === 'sqlite' && !form.filePath?.trim()) {
      setError(t('connection.fileRequired'));
      return;
    }
    if (network && !form.database?.trim()) {
      setError(t('connection.dbRequired'));
      return;
    }
    setSaving(true);
    try {
      const schema =
        form.driver === 'postgres'
          ? form.schema?.trim() || 'public'
          : form.driver === 'mysql'
            ? form.schema?.trim() || form.database?.trim() || ''
            : undefined;
      const saved = await api.saveConnection({
        ...form,
        database: form.database?.trim(),
        host: form.host?.trim(),
        schema,
      });
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(formatError(e));
    } finally {
      setSaving(false);
    }
  };

  const defaultPort = form.driver === 'mysql' ? 3306 : 5432;
  const schemaValue =
    form.driver === 'mysql' ? form.schema || form.database || '' : form.schema || 'public';

  return (
    <Modal title={isEdit ? t('connection.editTitle') : t('connection.newTitle')} onClose={onClose} size="md">
        <div className="modal-body">
          <div className="form-group">
            <label>{t('connection.name')}</label>
            <input value={form.name} onChange={(e) => update({ name: e.target.value })} placeholder={t('connection.namePlaceholder')} />
          </div>
          <div className="form-group">
            <label>{t('connection.driver')}</label>
            <select value={form.driver} onChange={(e) => handleDriverChange(e.target.value as DriverType)}>
              <option value="sqlite">{t('connection.sqlite')}</option>
              <option value="postgres">{t('connection.postgres')}</option>
              <option value="mysql">{t('connection.mysql')}</option>
            </select>
          </div>
          <div className="form-group form-group-checkbox">
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={!!form.readOnly}
                onChange={(e) => update({ readOnly: e.target.checked })}
              />
              <span className="checkbox-text">{t('connection.readOnly')}</span>
            </label>
            <p className="form-hint">{t('connection.readOnlyHint')}</p>
          </div>
          <div className="form-group">
            <label>{t('connection.tabColor')}</label>
            <div className="color-picker">
              {DEFAULT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`color-swatch ${form.color === c ? 'selected' : ''}`}
                  style={{ background: c }}
                  onClick={() => update({ color: c })}
                />
              ))}
            </div>
          </div>
          {form.driver === 'sqlite' ? (
            <div className="form-group">
              <label>{t('connection.file')}</label>
              <div className="form-file-row">
                <input
                  value={form.filePath || ''}
                  onChange={(e) => update({ filePath: e.target.value })}
                  placeholder={t('connection.filePlaceholder')}
                />
                <button type="button" className="btn" onClick={handlePickFile}>
                  {t('common.browse')}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label>{t('connection.host')}</label>
                  <input value={form.host || ''} onChange={(e) => update({ host: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>{t('connection.port')}</label>
                  <input
                    type="number"
                    value={form.port || defaultPort}
                    onChange={(e) => update({ port: parseInt(e.target.value, 10) || defaultPort }) }
                  />
                </div>
              </div>
              <div className="form-group">
                <label>{t('connection.databaseName')}</label>
                <input
                  value={form.database || ''}
                  onChange={(e) => update({ database: e.target.value })}
                  placeholder={
                    form.driver === 'mysql'
                      ? t('connection.databasePlaceholderMysql')
                      : t('connection.databasePlaceholder')
                  }
                  required
                />
                <p className="form-hint">
                  {form.driver === 'mysql' ? t('connection.databaseHintMysql') : t('connection.databaseHint')}
                </p>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>{t('connection.username')}</label>
                  <input value={form.username || ''} onChange={(e) => update({ username: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>{t('connection.password')}</label>
                  <input
                    type="password"
                    value={form.password || ''}
                    onChange={(e) => update({ password: e.target.value })}
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>{t('connection.sslMode')}</label>
                  <select value={form.sslMode || 'disable'} onChange={(e) => update({ sslMode: e.target.value })}>
                    <option value="disable">{t('connection.sslDisable')}</option>
                    <option value="require">{t('connection.sslRequire')}</option>
                    <option value="verify-full">{t('connection.sslVerifyFull')}</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>
                    {form.driver === 'mysql' ? t('connection.defaultSchemaMysql') : t('connection.defaultSchema')}
                  </label>
                  <input
                    value={schemaValue}
                    onChange={(e) => update({ schema: e.target.value })}
                    placeholder={form.driver === 'mysql' ? form.database || '' : 'public'}
                  />
                  {form.driver === 'mysql' && (
                    <p className="form-hint">{t('connection.defaultSchemaMysqlHint')}</p>
                  )}
                </div>
              </div>
            </>
          )}
          {error && <div className="form-alert form-alert--error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn" onClick={handleTest} disabled={testing || saving}>
            {testing ? t('common.testing') : t('common.test')}
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || testing}>
            {t('common.save')}
          </button>
        </div>
    </Modal>
  );
}
