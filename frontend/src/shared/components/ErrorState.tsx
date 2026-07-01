import { CircleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

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
  return (
    <div className="error-state">
      <div className="error-state-card" role="alert">
        <CircleAlert className="icon-lg error-state-icon" aria-hidden />
        <div className="error-state-body">
          <div className="error-state-header">
            <p className="error-state-title">{title ?? t('errors.generic')}</p>
            {code ? <span className="error-state-code">{code}</span> : null}
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
          {action ? (
            <div className="error-state-actions">
              <button type="button" className="btn btn-sm error-state-action" onClick={action.onClick}>
                {action.icon}
                {action.label}
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
