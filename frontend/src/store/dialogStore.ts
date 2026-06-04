import { create } from 'zustand';
import { t } from '@/i18n';

export interface AlertOptions {
  title: string;
  description?: string;
  detail?: string;
  confirmLabel?: string;
}

export interface ConfirmOptions {
  title: string;
  description?: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export interface PromptOptions {
  title: string;
  description?: string;
  label?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

type DialogRequest =
  | { type: 'alert'; opts: AlertOptions; resolve: () => void }
  | { type: 'confirm'; opts: ConfirmOptions; resolve: (value: boolean) => void }
  | { type: 'prompt'; opts: PromptOptions; resolve: (value: string | null) => void };

interface DialogState {
  current: DialogRequest | null;
  showAlert: (opts: AlertOptions | string) => Promise<void>;
  showConfirm: (opts: ConfirmOptions | string) => Promise<boolean>;
  showPrompt: (opts: PromptOptions | string) => Promise<string | null>;
  close: () => void;
}

function normalizeAlert(opts: AlertOptions | string): AlertOptions {
  if (typeof opts === 'string') {
    return { title: t('common.notice'), description: opts, confirmLabel: t('common.ok') };
  }
  return { confirmLabel: t('common.ok'), ...opts };
}

function normalizeConfirm(opts: ConfirmOptions | string): ConfirmOptions {
  if (typeof opts === 'string') {
    return {
      title: t('dialog.confirmTitle'),
      description: opts,
      confirmLabel: t('common.confirm'),
      cancelLabel: t('common.cancel'),
    };
  }
  return {
    confirmLabel: t('common.confirm'),
    cancelLabel: t('common.cancel'),
    ...opts,
  };
}

function normalizePrompt(opts: PromptOptions | string): PromptOptions {
  if (typeof opts === 'string') {
    return {
      title: t('dialog.inputTitle'),
      description: opts,
      label: t('dialog.inputLabel'),
      confirmLabel: t('common.ok'),
      cancelLabel: t('common.cancel'),
    };
  }
  return {
    label: t('dialog.nameLabel'),
    confirmLabel: t('common.ok'),
    cancelLabel: t('common.cancel'),
    ...opts,
  };
}

// Resolve a displaced dialog as cancelled before replacing it, so its awaiting caller doesn't hang.
function cancelCurrent(current: DialogRequest | null): void {
  if (!current) return;
  if (current.type === 'confirm') current.resolve(false);
  else if (current.type === 'prompt') current.resolve(null);
  else current.resolve();
}

export const useDialogStore = create<DialogState>((set, get) => ({
  current: null,

  showAlert: (opts) =>
    new Promise((resolve) => {
      cancelCurrent(get().current);
      set({
        current: {
          type: 'alert',
          opts: normalizeAlert(opts),
          resolve: () => {
            resolve();
            get().close();
          },
        },
      });
    }),

  showConfirm: (opts) =>
    new Promise((resolve) => {
      cancelCurrent(get().current);
      set({
        current: {
          type: 'confirm',
          opts: normalizeConfirm(opts),
          resolve: (value) => {
            resolve(value);
            get().close();
          },
        },
      });
    }),

  showPrompt: (opts) =>
    new Promise((resolve) => {
      cancelCurrent(get().current);
      set({
        current: {
          type: 'prompt',
          opts: normalizePrompt(opts),
          resolve: (value) => {
            resolve(value);
            get().close();
          },
        },
      });
    }),

  close: () => set({ current: null }),
}));
