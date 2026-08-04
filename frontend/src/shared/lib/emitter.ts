type Listener<T> = (payload: T) => void;

export interface Emitter<T> {
  emit: (payload: T) => void;
  subscribe: (listener: Listener<T>) => () => void;
}

/**
 * Typed one-shot command channel, for telling an imperative non-React object (a Monaco instance) to
 * do something now. Deliberately not store state: "insert this text at the cursor" is an action, not
 * a value worth persisting. Replaces window CustomEvents so the payload keeps its type instead of
 * needing an unchecked cast out of event.detail, and so the name is not global.
 */
export function createEmitter<T>(): Emitter<T> {
  const listeners = new Set<Listener<T>>();
  return {
    emit(payload) {
      for (const listener of listeners) listener(payload);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
