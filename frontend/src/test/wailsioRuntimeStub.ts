// Test stub for `@wailsio/runtime`. The real runtime accesses `window` at import
// time, which throws in the node-environment unit suite. Pure-logic tests only
// need the generated bindings to *load* (they never invoke the Go backend), so
// these no-op shims are sufficient. Wired in via the alias in vitest.config.ts.

const noop = (): void => undefined;
const identity = <T>(x: T): T => x;
const typeCreator = () => identity;

// Used by generated bindings (models/return-type constructors). They are only
// invoked when a Go method resolves, which never happens under test.
export const Create = {
  Any: identity,
  Array: typeCreator,
  Map: typeCreator,
  Nullable: typeCreator,
  Struct: typeCreator,
};

export const Call = { ByID: () => Promise.resolve(undefined) };

export class CancellablePromise<T> extends Promise<T> {}

// Runtime namespaces used by app components/hooks.
export const Window = {
  Minimise: noop,
  Maximise: noop,
  ToggleMaximise: noop,
  Fullscreen: noop,
  UnFullscreen: noop,
  IsFullscreen: () => Promise.resolve(false),
};
export const Application = { Quit: noop };
export const Browser = { OpenURL: noop };
export const Clipboard = { SetText: () => true, Text: () => Promise.resolve('') };
export const Events = { On: () => noop, Emit: noop, Off: noop };
export const WML = { Reload: noop };
