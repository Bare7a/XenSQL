import { t } from '@/i18n';
import { formatError } from '@/shared/lib/normalize';
import { type AlertOptions, type ConfirmOptions, type PromptOptions, useDialogStore } from '@/store/dialogStore';

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
  const message = formatError(err);
  // Multi-line errors read better in the scrollable detail <pre> than as a wrapped paragraph.
  const multiline = message.includes('\n');
  return appAlert({
    title: title ?? t('errors.generic'),
    description: multiline ? undefined : message,
    detail: multiline ? message : undefined,
  });
}
