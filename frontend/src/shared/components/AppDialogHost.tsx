import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/shared/components/Modal';
import { useDialogStore } from '@/store/dialogStore';

export function AppDialogHost() {
  const { t } = useTranslation();
  const current = useDialogStore((s) => s.current);
  const [promptValue, setPromptValue] = useState('');

  useEffect(() => {
    if (current?.type === 'prompt') {
      setPromptValue(current.opts.defaultValue ?? '');
    }
  }, [current]);

  if (!current) return null;

  if (current.type === 'alert') {
    const { opts } = current;
    return (
      <Modal
        title={opts.title}
        onClose={() => current.resolve()}
        size="sm"
        role="alertdialog"
        ariaDescribedById={opts.description ? 'app-dialog-desc' : opts.detail ? 'app-dialog-detail' : undefined}
      >
        <div className="modal-body">
          {opts.description && (
            <p className="modal-description" id="app-dialog-desc">
              {opts.description}
            </p>
          )}
          {opts.detail && (
            <pre className="modal-detail" id="app-dialog-detail">
              {opts.detail}
            </pre>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-primary" onClick={() => current.resolve()}>
            {opts.confirmLabel ?? t('common.ok')}
          </button>
        </div>
      </Modal>
    );
  }

  if (current.type === 'confirm') {
    const { opts } = current;
    return (
      <Modal
        title={opts.title}
        onClose={() => current.resolve(false)}
        size="sm"
        role="alertdialog"
        danger={opts.danger}
        ariaDescribedById={opts.description ? 'app-dialog-desc' : undefined}
      >
        <div className="modal-body">
          {opts.description && (
            <p className="modal-description" id="app-dialog-desc">
              {opts.description}
            </p>
          )}
          {opts.detail && <pre className="modal-detail">{opts.detail}</pre>}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={() => current.resolve(false)}>
            {opts.cancelLabel ?? t('common.cancel')}
          </button>
          <button
            type="button"
            className={`btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`}
            onClick={() => current.resolve(true)}
          >
            {opts.confirmLabel ?? t('common.confirm')}
          </button>
        </div>
      </Modal>
    );
  }

  const { opts } = current;
  const submitPrompt = () => {
    const trimmed = promptValue.trim();
    if (!trimmed) return;
    current.resolve(trimmed);
  };

  return (
    <Modal
      title={opts.title}
      onClose={() => current.resolve(null)}
      size="sm"
      ariaDescribedById={opts.description ? 'app-dialog-desc' : undefined}
    >
      <div className="modal-body">
        {opts.description && (
          <p className="modal-description" id="app-dialog-desc">
            {opts.description}
          </p>
        )}
        <div className="form-group">
          <label htmlFor="app-dialog-prompt-input">{opts.label ?? t('dialog.inputLabel')}</label>
          <input
            id="app-dialog-prompt-input"
            value={promptValue}
            placeholder={opts.placeholder}
            onChange={(e) => setPromptValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitPrompt();
            }}
          />
        </div>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn" onClick={() => current.resolve(null)}>
          {opts.cancelLabel ?? t('common.cancel')}
        </button>
        <button type="button" className="btn btn-primary" onClick={submitPrompt} disabled={!promptValue.trim()}>
          {opts.confirmLabel ?? t('common.ok')}
        </button>
      </div>
    </Modal>
  );
}
