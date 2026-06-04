import { BrowserOpenURL } from '@wails/runtime/runtime';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/shared/components/Modal';
import type { AppInfo } from '@/shared/lib/appInfo';

interface Props {
  info: AppInfo;
  onClose: () => void;
}

export function AboutDialog({ info, onClose }: Props) {
  const { t } = useTranslation();

  const openRepo = () => {
    try {
      BrowserOpenURL(info.repository);
    } catch {
      window.open(info.repository, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <Modal title={t('about.title', { name: info.name })} onClose={onClose} size="md">
      <div className="modal-body about-dialog-body">
        <p className="modal-description">{info.description}</p>
        <dl className="about-meta">
          <div>
            <dt>{t('about.version')}</dt>
            <dd>{info.version}</dd>
          </div>
          <div>
            <dt>{t('about.createdBy')}</dt>
            <dd>
              {info.author}
              {info.email ? (
                <>
                  {' '}
                  <a className="about-link" href={`mailto:${info.email}`}>
                    {info.email}
                  </a>
                </>
              ) : null}
            </dd>
          </div>
          <div>
            <dt>{t('about.repository')}</dt>
            <dd>
              <button type="button" className="about-link-btn" onClick={openRepo}>
                {info.repository}
              </button>
            </dd>
          </div>
        </dl>
        <p className="about-stack">{t('about.stack')}</p>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </Modal>
  );
}
