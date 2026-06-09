import { loader } from '@monaco-editor/react';

type Editor = import('monaco-editor').editor.ICodeEditor;

export type EditAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll';

let lastFocusedTarget: HTMLElement | null = null;
let initialized = false;

function isNativeEditable(el: Element | null): el is HTMLInputElement | HTMLTextAreaElement | HTMLElement {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    const t = el.type;
    return (
      t === 'text' ||
      t === 'search' ||
      t === 'url' ||
      t === 'tel' ||
      t === 'password' ||
      t === 'email' ||
      t === 'number' ||
      t === ''
    );
  }
  if (el instanceof HTMLElement && el.isContentEditable) return true;
  return false;
}

function isInsideMonaco(el: Element | null): boolean {
  return !!el && !!(el as HTMLElement).closest?.('.monaco-editor');
}

function ensureInit() {
  if (initialized || typeof document === 'undefined') return;
  initialized = true;
  document.addEventListener(
    'focusin',
    (e) => {
      const target = e.target as HTMLElement | null;
      if (target && (isNativeEditable(target) || isInsideMonaco(target))) {
        lastFocusedTarget = target;
      }
    },
    true,
  );
}

ensureInit();

const MONACO_TRIGGER_IDS: Record<Exclude<EditAction, 'paste'>, string> = {
  undo: 'undo',
  redo: 'redo',
  cut: 'editor.action.clipboardCutAction',
  copy: 'editor.action.clipboardCopyAction',
  selectAll: 'editor.action.selectAll',
};

const EXEC_COMMAND_IDS: Record<EditAction, string> = {
  undo: 'undo',
  redo: 'redo',
  cut: 'cut',
  copy: 'copy',
  paste: 'paste',
  selectAll: 'selectAll',
};

async function runOnMonaco(target: HTMLElement, action: EditAction) {
  let monaco: Awaited<ReturnType<typeof loader.init>>;
  try {
    monaco = await loader.init();
  } catch {
    return;
  }
  const editors = monaco.editor.getEditors();
  const editor = editors.find((ed: Editor) => {
    const node = ed.getDomNode();
    return !!node && node.contains(target);
  });
  if (!editor) return;
  editor.focus();
  if (action === 'paste') {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      editor.trigger('menu', 'paste', { text });
    } catch {
      /* clipboard permissions may deny - silently skip */
    }
    return;
  }
  editor.trigger('menu', MONACO_TRIGGER_IDS[action], null);
}

async function runOnNative(target: HTMLElement, action: EditAction) {
  target.focus();
  if (action === 'paste') {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      document.execCommand('insertText', false, text);
    } catch {
      /* ignore */
    }
    return;
  }
  document.execCommand(EXEC_COMMAND_IDS[action]);
}

export async function runEditAction(action: EditAction): Promise<void> {
  const target = lastFocusedTarget;
  if (!target || !document.body.contains(target)) return;
  if (isInsideMonaco(target)) {
    await runOnMonaco(target, action);
  } else {
    await runOnNative(target, action);
  }
}
