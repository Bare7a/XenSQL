import { CircleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface ErrorStateProps {
  message: string;
  title?: string;
}

export function ErrorState({ message, title }: ErrorStateProps) {
  const { t } = useTranslation();
  return (
    <div className="error-state">
      <div className="error-state-card" role="alert">
        <CircleAlert className="icon-lg error-state-icon" aria-hidden />
        <div className="error-state-body">
          <p className="error-state-title">{title ?? t('errors.generic')}</p>
          <p className="error-state-message">{message}</p>
        </div>
      </div>
    </div>
  );
}
