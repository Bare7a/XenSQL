import { Browser } from '@wailsio/runtime';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/shared/components/Modal';
import { api } from '@/shared/lib/api';
import type { AppInfo } from '@/shared/lib/appInfo';

interface Props {
  info: AppInfo;
  onClose: () => void;
}

export function AboutDialog({ info, onClose }: Props) {
  const { t } = useTranslation();

  const openUrl = (url: string) => {
    try {
      Browser.OpenURL(url);
    } catch {
      window.open(url, '_blank', 'noopener,noreferrer');
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
            <dt>{t('about.website')}</dt>
            <dd>
              <button type="button" className="about-link-btn" onClick={() => openUrl(info.website)}>
                {info.website}
              </button>
            </dd>
          </div>
          <div>
            <dt>{t('about.repository')}</dt>
            <dd>
              <button type="button" className="about-link-btn" onClick={() => openUrl(info.repository)}>
                {info.repository}
              </button>
            </dd>
          </div>
        </dl>
        <p className="about-stack">{t('about.stack')}</p>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn" onClick={() => void api.checkForUpdates()}>
          {t('about.checkUpdates')}
        </button>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
    </Modal>
  );
}
