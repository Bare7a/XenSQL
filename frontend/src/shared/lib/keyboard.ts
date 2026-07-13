const CODE_KEYS: Record<string, string> = {
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  Slash: '/',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Backquote: '`',
};

function latinKeyFromCode(code: string | undefined): string | null {
  if (!code) return null;
  if (/^Key[A-Z]$/.test(code)) return code[3].toLowerCase();
  if (/^Digit[0-9]$/.test(code)) return code[5];
  return CODE_KEYS[code] ?? null;
}

/**
 * The character to match shortcuts against. Non-Latin layouts (e.g. Bulgarian Phonetic) produce
 * characters no binding uses, so fall back to the physical key's US-layout character; Latin
 * layouts (AZERTY, Dvorak, ...) keep e.key so bindings follow the printed key labels.
 */
export function shortcutKey(e: KeyboardEvent): string {
  const key = e.key;
  if (key.length === 1 && key.charCodeAt(0) > 127) {
    return latinKeyFromCode(e.code) ?? key;
  }
  return key;
}
