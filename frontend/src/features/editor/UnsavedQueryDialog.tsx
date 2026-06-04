import { useTranslation } from 'react-i18next';
import { Modal } from '@/shared/components/Modal';

interface Props {
  queryName: string;
  onSaveAndClose: () => void;
  onDiscardAndClose: () => void;
  onCancel: () => void;
}

export function UnsavedQueryDialog({ queryName, onSaveAndClose, onDiscardAndClose, onCancel }: Props) {
  const { t } = useTranslation();

  return (
    <Modal title={t('dialog.unsavedTitle')} onClose={onCancel} size="sm">
      <div className="modal-body">
        <p className="modal-description">{t('dialog.unsavedDescription')}</p>
        {queryName ? (
          <p className="unsaved-query-hint">
            <strong>{queryName}</strong>
          </p>
        ) : null}
      </div>
      <div className="modal-footer unsaved-query-footer">
        <button type="button" className="btn" onClick={onCancel}>
          {t('dialog.unsavedCancel')}
        </button>
        <button type="button" className="btn btn-danger" onClick={onDiscardAndClose}>
          {t('dialog.unsavedDiscard')}
        </button>
        <button type="button" className="btn btn-primary" onClick={onSaveAndClose}>
          {t('dialog.unsavedSave')}
        </button>
      </div>
    </Modal>
  );
}
