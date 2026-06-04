import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/shared/components/Modal';

interface Props {
  initialName: string;
  description?: string;
  onConfirm: (name: string) => void;
  onClose: () => void;
}

export function RenameQueryDialog({ initialName, description, onConfirm, onClose }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(initialName);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
  };

  return (
    <Modal title={t('dialog.renameQueryTitle')} onClose={onClose} size="sm">
      <div className="modal-body">
        {description ? <p className="modal-description">{description}</p> : null}
        <div className="form-group">
          <label htmlFor="rename-query-input">{t('dialog.renameQueryLabel')}</label>
          <input
            id="rename-query-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            autoFocus
          />
        </div>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn" onClick={onClose}>
          {t('common.cancel')}
        </button>
        <button type="button" className="btn btn-primary" onClick={submit} disabled={!name.trim()}>
          {t('common.rename')}
        </button>
      </div>
    </Modal>
  );
}
