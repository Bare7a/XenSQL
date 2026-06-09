export type ContentKind = 'json' | 'xml' | 'html' | 'text' | 'null' | 'empty';

export function isStructuredKind(kind: ContentKind): boolean {
  return kind === 'json' || kind === 'xml' || kind === 'html';
}

export function monacoLanguageForKind(kind: ContentKind): string {
  if (kind === 'json') return 'json';
  if (kind === 'xml') return 'xml';
  if (kind === 'html') return 'html';
  return 'plaintext';
}

/** Concrete languages the cell-viewer type dropdown offers; 'null'/'empty' are auto-only states. */
export const SELECTABLE_KINDS: readonly ContentKind[] = ['text', 'json', 'xml', 'html'];

/** The dropdown option that represents a kind: structured kinds map to themselves, the rest to text. */
export function dropdownKind(kind: ContentKind): ContentKind {
  return isStructuredKind(kind) ? kind : 'text';
}

const KIND_LABEL_KEYS: Record<ContentKind, string> = {
  null: 'cellViewer.kindNull',
  empty: 'cellViewer.kindEmpty',
  json: 'cellViewer.kindJson',
  xml: 'cellViewer.kindXml',
  html: 'cellViewer.kindHtml',
  text: 'cellViewer.kindText',
};

/** i18n key for a kind's display label. */
export function kindLabelKey(kind: ContentKind): string {
  return KIND_LABEL_KEYS[kind];
}

export function detectKind(raw: string): ContentKind {
  if (!raw.trim()) return 'empty';
  const trimmed = raw.trim();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      /* fall through */
    }
  }

  if (/^<!DOCTYPE\s+html/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    return 'html';
  }

  if (trimmed.startsWith('<?xml')) {
    return 'xml';
  }

  if (trimmed.startsWith('<') && trimmed.includes('>')) {
    if (/<\/?(html|head|body|div|span|p|a|script|style|meta|link|table|form|input)\b/i.test(trimmed)) {
      return 'html';
    }
    return 'xml';
  }

  return 'text';
}

// Reformatting round-trips numbers through float64, truncating integers beyond 2^53 (e.g. a bigint id)
// - and the result can be saved back - so skip it when the source has a 16+ digit integer literal.
const UNSAFE_INT_RE = /\d{16,}/;

export function beautifyJson(raw: string): string {
  const trimmed = raw.trim();
  if (UNSAFE_INT_RE.test(trimmed)) return trimmed;
  return JSON.stringify(JSON.parse(trimmed), null, 2);
}

export function minifyJson(raw: string): string {
  const trimmed = raw.trim();
  if (UNSAFE_INT_RE.test(trimmed)) return trimmed;
  return JSON.stringify(JSON.parse(trimmed));
}

export function formatMarkup(markup: string): string {
  try {
    const withBreaks = markup.replace(/>\s*</g, '>\n<');
    const lines = withBreaks.split('\n').filter((l) => l.trim());
    let depth = 0;
    return lines
      .map((line) => {
        const trimmed = line.trim();
        if (trimmed.match(/^<\//)) depth = Math.max(0, depth - 1);
        const indented = '  '.repeat(depth) + trimmed;
        if (trimmed.match(/^<[^!?/][^>]*[^/]>$/) && !trimmed.endsWith('/>')) depth++;
        return indented;
      })
      .join('\n');
  } catch {
    return markup;
  }
}

export function minifyMarkup(markup: string): string {
  // Collapse only whitespace *between* tags; whitespace inside text nodes is significant and must survive.
  return markup.trim().replace(/>\s+</g, '><');
}

export function initialContent(raw: string, isNull: boolean): { text: string; kind: ContentKind } {
  if (isNull) return { text: 'NULL', kind: 'null' };
  const kind = detectKind(raw);
  if (kind === 'json') {
    try {
      return { text: beautifyJson(raw), kind: 'json' };
    } catch {
      return { text: raw, kind: 'text' };
    }
  }
  if (kind === 'xml' || kind === 'html') {
    return { text: formatMarkup(raw.trim()), kind };
  }
  return { text: raw, kind };
}

export function applyContentFormat(
  content: string,
  kind: ContentKind,
  mode: 'beautify' | 'minify',
): { text: string; kind: ContentKind } {
  const formatKind = (k: ContentKind) => {
    if (k === 'json') {
      return {
        text: mode === 'beautify' ? beautifyJson(content) : minifyJson(content),
        kind: 'json' as const,
      };
    }
    if (k === 'xml' || k === 'html') {
      return {
        text: mode === 'beautify' ? formatMarkup(content) : minifyMarkup(content),
        kind: k,
      };
    }
    throw new Error('unsupported');
  };

  if (kind === 'json' || kind === 'xml' || kind === 'html') {
    return formatKind(kind);
  }

  const detected = detectKind(content);
  if (detected === 'json' || detected === 'xml' || detected === 'html') {
    return formatKind(detected);
  }

  throw new Error('not structured');
}
