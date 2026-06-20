import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useToastStore } from '@/store/toastStore';

export function AppToastLayer() {
  const { t } = useTranslation();
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="app-toast-host" aria-live="polite" aria-relevant="additions">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`app-toast app-toast-${toast.kind}`}
          role="status"
          data-testid={`toast-${toast.kind}`}
        >
          <span className="app-toast-message">{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              className="app-toast-action"
              onClick={() => {
                toast.action?.onClick();
                dismiss(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          ) : null}
          <button
            type="button"
            className="app-toast-dismiss"
            aria-label={t('toast.dismiss')}
            onClick={() => dismiss(toast.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
