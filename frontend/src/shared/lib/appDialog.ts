import { formatError } from '@/shared/lib/normalize';
import { t } from '@/i18n';
import { useDialogStore, type AlertOptions, type ConfirmOptions, type PromptOptions } from '@/store/dialogStore';

export type { AlertOptions, ConfirmOptions, PromptOptions };

export function appAlert(opts: AlertOptions | string): Promise<void> {
  return useDialogStore.getState().showAlert(opts);
}

export function appConfirm(opts: ConfirmOptions | string): Promise<boolean> {
  return useDialogStore.getState().showConfirm(opts);
}

export function appPrompt(opts: PromptOptions | string): Promise<string | null> {
  return useDialogStore.getState().showPrompt(opts);
}

export function appError(err: unknown, title?: string): Promise<void> {
  return appAlert({
    title: title ?? t('errors.generic'),
    description: formatError(err),
  });
}
