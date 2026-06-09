import { X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useModalEscape } from '@/shared/hooks/useModalEscape';

export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Ref-counted so nested modals don't restore body scroll while another is still open.
let modalScrollLockCount = 0;
let savedBodyOverflow = '';

interface ModalProps {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  size?: ModalSize;
  scrollBody?: boolean;
  className?: string;
  danger?: boolean;
  headerExtra?: ReactNode;
  role?: 'dialog' | 'alertdialog';
  ariaDescribedById?: string;
  /** Pass `false` to suspend Escape (e.g. while recording a shortcut). */
  escapeEnabled?: boolean;
  showClose?: boolean;
  closeLabel?: string;
}

export function Modal({
  title,
  onClose,
  children,
  size = 'md',
  scrollBody = false,
  className,
  danger = false,
  headerExtra,
  role = 'dialog',
  ariaDescribedById,
  escapeEnabled = true,
  showClose = true,
  closeLabel,
}: ModalProps) {
  const { t } = useTranslation();
  const titleId = useId();
  useModalEscape(onClose, escapeEnabled);

  const dialogRef = useRef<HTMLDivElement>(null);
  // Capture the trigger at first render, before children mount / autoFocus moves focus inward.
  const restoreFocusRef = useRef<HTMLElement | null>(
    typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null,
  );

  useEffect(() => {
    const dialog = dialogRef.current;

    if (modalScrollLockCount === 0) {
      savedBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    modalScrollLockCount++;

    // Respect a child autoFocus; otherwise focus the first focusable (or the dialog).
    if (dialog && !dialog.contains(document.activeElement)) {
      const focusables = dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      (focusables[0] ?? dialog).focus();
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !dialog) return;
      const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null || el === document.activeElement,
      );
      if (focusables.length === 0) {
        e.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    dialog?.addEventListener('keydown', onKeyDown);

    const toRestore = restoreFocusRef.current;
    return () => {
      dialog?.removeEventListener('keydown', onKeyDown);
      modalScrollLockCount--;
      if (modalScrollLockCount === 0) document.body.style.overflow = savedBodyOverflow;
      if (toRestore?.isConnected) toRestore.focus();
    };
  }, []);

  const label = closeLabel ?? t('common.close');
  const classes = ['modal', `modal-${size}`, scrollBody && 'modal-scroll', danger && 'app-dialog-danger', className]
    .filter(Boolean)
    .join(' ');

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop click-to-dismiss is a redundant convenience; the dialog is keyboard-dismissable via Escape (useModalEscape) and the close button.
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is always 'dialog' or 'alertdialog', both of which support aria-labelledby/aria-describedby; biome cannot resolve the dynamic role prop statically. */}
      <div
        ref={dialogRef}
        className={classes}
        role={role}
        tabIndex={-1}
        aria-labelledby={titleId}
        aria-describedby={ariaDescribedById}
      >
        <div className="modal-header">
          <div className="modal-header-title" id={titleId}>
            {title}
            {headerExtra}
          </div>
          {showClose && (
            <button type="button" className="modal-close" onClick={onClose} aria-label={label} data-tooltip={label}>
              <X className="icon-md" />
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  );
}
