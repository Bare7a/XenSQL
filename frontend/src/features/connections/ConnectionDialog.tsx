import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/shared/components/Modal';
import { api } from '@/shared/lib/api';
import { appToast } from '@/shared/lib/appToast';
import { formatError } from '@/shared/lib/normalize';
import type { ConnectionConfig, DriverType } from '@/types';
import { DEFAULT_COLORS, DEFAULT_CONNECTION_COLOR, isSqliteFamily } from '@/types';

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
  // Switching away from Turso clears its fields so no stale token is carried over.
  if (driver === 'turso') {
    return { schema: '' };
  }
  return { remoteUrl: '', authToken: '', experimentalFeatures: '' };
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
    },
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
      if (path) {
        const fallbackName = form.driver === 'turso' ? 'Turso' : 'SQLite';
        update({ filePath: path, name: form.name || path.split(/[/\\]/).pop() || fallbackName });
      }
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
    if (isSqliteFamily(form.driver) && !form.filePath?.trim()) {
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
        // Only Turso persists these, so a token can't linger on a connection that no longer uses it.
        remoteUrl: form.driver === 'turso' ? form.remoteUrl?.trim() : undefined,
        authToken: form.driver === 'turso' ? form.authToken?.trim() : undefined,
        experimentalFeatures: form.driver === 'turso' ? form.experimentalFeatures?.trim() : undefined,
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
  const schemaValue = form.driver === 'mysql' ? form.schema || form.database || '' : form.schema || 'public';

  return (
    <Modal title={isEdit ? t('connection.editTitle') : t('connection.newTitle')} onClose={onClose} size="md">
      <div className="modal-body">
        <div className="form-group">
          <label htmlFor="conn-name">{t('connection.name')}</label>
          <input
            id="conn-name"
            value={form.name}
            onChange={(e) => update({ name: e.target.value })}
            placeholder={t('connection.namePlaceholder')}
          />
        </div>
        <div className="form-group">
          <label htmlFor="conn-driver">{t('connection.driver')}</label>
          <select
            id="conn-driver"
            value={form.driver}
            onChange={(e) => handleDriverChange(e.target.value as DriverType)}
          >
            <option value="sqlite">{t('connection.sqlite')}</option>
            <option value="postgres">{t('connection.postgres')}</option>
            <option value="mysql">{t('connection.mysql')}</option>
            <option value="turso">{t('connection.turso')}</option>
          </select>
        </div>
        <div className="form-group form-group-checkbox">
          <label className="checkbox-label">
            <input type="checkbox" checked={!!form.readOnly} onChange={(e) => update({ readOnly: e.target.checked })} />
            <span className="checkbox-text">{t('connection.readOnly')}</span>
          </label>
          <p className="form-hint">{t('connection.readOnlyHint')}</p>
        </div>
        <div className="form-group">
          <label htmlFor="conn-color">{t('connection.tabColor')}</label>
          <div className="color-picker" id="conn-color">
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
        {isSqliteFamily(form.driver) ? (
          <>
            <div className="form-group">
              <label htmlFor="conn-file">
                {form.driver === 'turso' ? t('connection.tursoFile') : t('connection.file')}
              </label>
              <div className="form-file-row">
                <input
                  id="conn-file"
                  value={form.filePath || ''}
                  onChange={(e) => update({ filePath: e.target.value })}
                  placeholder={t('connection.filePlaceholder')}
                />
                <button type="button" className="btn" onClick={handlePickFile}>
                  {t('common.browse')}
                </button>
              </div>
              {form.driver === 'turso' && <p className="form-hint">{t('connection.tursoFileHint')}</p>}
            </div>
            {form.driver === 'turso' && (
              <>
                <div className="form-group">
                  <label htmlFor="conn-remote-url">{t('connection.tursoRemoteUrl')}</label>
                  <input
                    id="conn-remote-url"
                    value={form.remoteUrl || ''}
                    onChange={(e) => update({ remoteUrl: e.target.value })}
                    placeholder="https://my-db-my-org.turso.io"
                  />
                  <p className="form-hint">{t('connection.tursoRemoteUrlHint')}</p>
                </div>
                <div className="form-group">
                  <label htmlFor="conn-auth-token">{t('connection.tursoAuthToken')}</label>
                  <input
                    id="conn-auth-token"
                    type="password"
                    autoComplete="off"
                    value={form.authToken || ''}
                    onChange={(e) => update({ authToken: e.target.value })}
                  />
                  <p className="form-hint">{t('connection.tursoAuthTokenHint')}</p>
                </div>
                <div className="form-group">
                  <label htmlFor="conn-experimental-features">{t('connection.tursoExperimentalFeatures')}</label>
                  <input
                    id="conn-experimental-features"
                    value={form.experimentalFeatures || ''}
                    onChange={(e) => update({ experimentalFeatures: e.target.value })}
                    placeholder="views"
                  />
                  <p className="form-hint">{t('connection.tursoExperimentalFeaturesHint')}</p>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="conn-host">{t('connection.host')}</label>
                <input id="conn-host" value={form.host || ''} onChange={(e) => update({ host: e.target.value })} />
              </div>
              <div className="form-group">
                <label htmlFor="conn-port">{t('connection.port')}</label>
                <input
                  id="conn-port"
                  type="number"
                  value={form.port || defaultPort}
                  onChange={(e) => update({ port: parseInt(e.target.value, 10) || defaultPort })}
                />
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="conn-database">{t('connection.databaseName')}</label>
              <input
                id="conn-database"
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
                <label htmlFor="conn-username">{t('connection.username')}</label>
                <input
                  id="conn-username"
                  value={form.username || ''}
                  onChange={(e) => update({ username: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label htmlFor="conn-password">{t('connection.password')}</label>
                <input
                  id="conn-password"
                  type="password"
                  value={form.password || ''}
                  onChange={(e) => update({ password: e.target.value })}
                />
              </div>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="conn-ssl-mode">{t('connection.sslMode')}</label>
                <select
                  id="conn-ssl-mode"
                  value={form.sslMode || 'disable'}
                  onChange={(e) => update({ sslMode: e.target.value })}
                >
                  <option value="disable">{t('connection.sslDisable')}</option>
                  <option value="require">{t('connection.sslRequire')}</option>
                  <option value="verify-full">{t('connection.sslVerifyFull')}</option>
                </select>
              </div>
              <div className="form-group">
                <label htmlFor="conn-schema">
                  {form.driver === 'mysql' ? t('connection.defaultSchemaMysql') : t('connection.defaultSchema')}
                </label>
                <input
                  id="conn-schema"
                  value={schemaValue}
                  onChange={(e) => update({ schema: e.target.value })}
                  placeholder={form.driver === 'mysql' ? form.database || '' : 'public'}
                />
                {form.driver === 'mysql' && <p className="form-hint">{t('connection.defaultSchemaMysqlHint')}</p>}
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
