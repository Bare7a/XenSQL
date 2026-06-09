import { type ToastKind, useToastStore } from '@/store/toastStore';

export type { ToastKind };

function show(message: string, kind: ToastKind, durationMs?: number): void {
  useToastStore.getState().push(message, kind, durationMs);
}

export const appToast = {
  info(message: string, durationMs?: number) {
    show(message, 'info', durationMs);
  },
  success(message: string, durationMs?: number) {
    show(message, 'success', durationMs);
  },
  error(message: string, durationMs?: number) {
    show(message, 'error', durationMs);
  },
};
