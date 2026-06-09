import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/shared/components/Modal';
import {
  APP_SHORTCUTS,
  bindingFromKeyboardEvent,
  findConflictingShortcut,
  formatBinding,
  getEffectiveBinding,
  getShortcutCategory,
  getShortcutLabel,
  type KeyBinding,
  resetAllShortcutBindings,
  resetShortcutBinding,
  type ShortcutDef,
  setCapturingBinding,
  setShortcutBinding,
  subscribeShortcutsChanged,
} from '@/shared/lib/shortcuts';

interface Props {
  onClose: () => void;
}

export function ShortcutsDialog({ onClose }: Props) {
  const { t } = useTranslation();
  const [revision, setRevision] = useState(0);
  const [recordingId, setRecordingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => subscribeShortcutsChanged(() => setRevision((n) => n + 1)), []);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof APP_SHORTCUTS>();
    for (const def of APP_SHORTCUTS) {
      const list = map.get(def.category) ?? [];
      list.push(def);
      map.set(def.category, list);
    }
    return map;
  }, [revision]);

  const applyBinding = useCallback(
    (id: string, binding: KeyBinding) => {
      const conflict = findConflictingShortcut(id, binding);
      if (conflict) {
        setError(t('shortcuts.conflict', { label: getShortcutLabel(conflict.id) }));
        return;
      }
      setShortcutBinding(id, binding);
      setRecordingId(null);
      setError(null);
    },
    [t],
  );

  useEffect(() => {
    if (!recordingId) return;
    setCapturingBinding(true);

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        setRecordingId(null);
        setError(null);
        return;
      }
      const binding = bindingFromKeyboardEvent(e);
      if (!binding) return;
      applyBinding(recordingId, binding);
    };

    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      setCapturingBinding(false);
    };
  }, [recordingId, applyBinding]);

  return (
    <Modal title={t('shortcuts.title')} onClose={onClose} size="md" scrollBody escapeEnabled={!recordingId}>
      <div className="modal-body">
        <p className="modal-description">{t('shortcuts.intro')}</p>
        {recordingId && (
          <p className="shortcuts-recording" role="status">
            {t('shortcuts.recording', { label: getShortcutLabel(recordingId) })}
          </p>
        )}
        {error && (
          <p className="form-alert form-alert--error" role="alert">
            {error}
          </p>
        )}
        {[...grouped.entries()].map(([category, items]) => (
          <section key={category} className="shortcuts-section">
            <h3 className="shortcuts-section-title">{getShortcutCategory(category as ShortcutDef['category'])}</h3>
            <table className="shortcuts-table">
              <tbody>
                {items.map((def) => {
                  const binding = getEffectiveBinding(def.id);
                  const isDefault = formatBinding(binding) === formatBinding(def.defaultBinding);
                  return (
                    <tr key={def.id}>
                      <td className="shortcuts-label">{getShortcutLabel(def.id)}</td>
                      <td className="shortcuts-actions">
                        {!isDefault && (
                          <button type="button" className="btn btn-sm" onClick={() => resetShortcutBinding(def.id)}>
                            {t('shortcuts.reset')}
                          </button>
                        )}
                      </td>
                      <td className="shortcuts-keys">
                        <button
                          type="button"
                          className={`shortcuts-key-btn${recordingId === def.id ? ' recording' : ''}`}
                          onClick={() => {
                            setRecordingId(def.id);
                            setError(null);
                          }}
                        >
                          {formatBinding(binding)}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        ))}
        <p className="shortcuts-note">{t('shortcuts.note')}</p>
      </div>
      <div className="modal-footer">
        <button
          type="button"
          className="btn"
          onClick={() => {
            resetAllShortcutBindings();
            setError(null);
          }}
        >
          {t('shortcuts.resetAll')}
        </button>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </Modal>
  );
}
