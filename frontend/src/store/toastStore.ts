import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
  action?: ToastAction;
}

const MAX_TOASTS = 5;
const DEFAULT_DURATION_MS = 3500;

let nextId = 1;
const timers = new Map<number, ReturnType<typeof setTimeout>>();

interface ToastState {
  toasts: ToastItem[];
  push: (message: string, kind?: ToastKind, durationMs?: number, action?: ToastAction) => void;
  dismiss: (id: number) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  push(message, kind = 'info', durationMs = DEFAULT_DURATION_MS, action) {
    const trimmed = message.trim();
    if (!trimmed) return;

    const id = nextId++;
    const item: ToastItem = { id, message: trimmed, kind, action };

    const combined = [...get().toasts, item];
    // Clear timers for toasts dropped by the cap so they don't linger until expiry.
    for (const dropped of combined.slice(0, Math.max(0, combined.length - MAX_TOASTS))) {
      const t = timers.get(dropped.id);
      if (t) {
        clearTimeout(t);
        timers.delete(dropped.id);
      }
    }
    set({ toasts: combined.slice(-MAX_TOASTS) });

    // durationMs <= 0 keeps the toast until the user acts on or dismisses it.
    if (durationMs > 0) {
      timers.set(
        id,
        setTimeout(() => {
          timers.delete(id);
          get().dismiss(id);
        }, durationMs),
      );
    }
  },

  dismiss(id) {
    const t = timers.get(id);
    if (t) {
      clearTimeout(t);
      timers.delete(id);
    }
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    }));
  },
}));
