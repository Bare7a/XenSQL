import { CircleAlert, Copy } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/shared/lib/api';
import { appToast } from '@/shared/lib/appToast';

interface ErrorStateAction {
  label: string;
  onClick: () => void;
  icon?: ReactNode;
}

interface ErrorStateProps {
  message: string;
  title?: string;
  code?: string;
  hint?: string;
  detail?: string;
  action?: ErrorStateAction;
}

export function ErrorState({ message, title, code, hint, detail, action }: ErrorStateProps) {
  const { t } = useTranslation();

  const copyError = async () => {
    const parts = [code ? `${code}: ${message}` : message];
    if (detail) parts.push(`${t('errors.detailLabel')}: ${detail}`);
    if (hint) parts.push(`${t('errors.hintLabel')}: ${hint}`);
    try {
      await api.copyToClipboard(parts.join('\n'));
      appToast.success(t('toast.copiedClipboard'));
    } catch {
      appToast.error(t('errors.copyFailed'));
    }
  };

  return (
    <div className="error-state">
      <div className="error-state-card" role="alert">
        <div className="error-state-header">
          <CircleAlert className="icon-sm error-state-icon" aria-hidden />
          <p className="error-state-title">{title ?? t('errors.generic')}</p>
          {code ? <span className="error-state-code">{code}</span> : null}
          <div className="error-state-header-actions">
            {action ? (
              <button type="button" className="btn btn-sm error-state-action" onClick={action.onClick}>
                {action.icon}
                {action.label}
              </button>
            ) : null}
            <button
              type="button"
              className="error-state-copy"
              data-tooltip={t('common.copy')}
              aria-label={t('common.copy')}
              onClick={copyError}
            >
              <Copy className="icon-xs" />
            </button>
          </div>
        </div>
        <p className="error-state-message">{message}</p>
        {detail ? (
          <p className="error-state-meta">
            <span className="error-state-meta-label">{t('errors.detailLabel')}</span> {detail}
          </p>
        ) : null}
        {hint ? (
          <p className="error-state-meta error-state-hint">
            <span className="error-state-meta-label">{t('errors.hintLabel')}</span> {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}
