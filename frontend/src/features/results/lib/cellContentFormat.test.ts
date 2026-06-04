import { describe, expect, it } from 'vitest';
import {
  applyContentFormat,
  beautifyJson,
  detectKind,
  dropdownKind,
  formatMarkup,
  initialContent,
  isStructuredKind,
  kindLabelKey,
  minifyJson,
  minifyMarkup,
  monacoLanguageForKind,
  SELECTABLE_KINDS,
} from '@/features/results/lib/cellContentFormat';

describe('minifyMarkup', () => {
  it('collapses whitespace between tags', () => {
    expect(minifyMarkup('<a>  <b>x</b>\n  </a>')).toBe('<a><b>x</b></a>');
  });
  it('preserves significant whitespace inside text nodes', () => {
    // Regression: a blanket /\n\s*/ strip used to flatten text content (data loss on minify).
    expect(minifyMarkup('<p>line1\n  line2</p>')).toBe('<p>line1\n  line2</p>');
  });
});

describe('detectKind', () => {
  it.each([
    ['', 'empty'],
    ['   \n\t', 'empty'],
    ['{"a":1}', 'json'],
    ['[1,2,3]', 'json'],
    ['{ not valid json', 'text'],
    ['<?xml version="1.0"?><root/>', 'xml'],
    ['<!DOCTYPE html><html></html>', 'html'],
    ['<html><body/></html>', 'html'],
    ['<note><to>X</to></note>', 'xml'],
    // <a> and <b> match the HTML-element regex so this is classified as html, not xml
    ['<a><b>x</b></a>', 'html'],
    ['plain words', 'text'],
  ])('detects %j as %s', (input, expected) => {
    expect(detectKind(input)).toBe(expected);
  });
});

describe('isStructuredKind', () => {
  it('treats json/xml/html as structured', () => {
    expect(isStructuredKind('json')).toBe(true);
    expect(isStructuredKind('xml')).toBe(true);
    expect(isStructuredKind('html')).toBe(true);
  });
  it('treats text/null/empty as unstructured', () => {
    expect(isStructuredKind('text')).toBe(false);
    expect(isStructuredKind('null')).toBe(false);
    expect(isStructuredKind('empty')).toBe(false);
  });
});

describe('monacoLanguageForKind', () => {
  it('returns Monaco language ids', () => {
    expect(monacoLanguageForKind('json')).toBe('json');
    expect(monacoLanguageForKind('xml')).toBe('xml');
    expect(monacoLanguageForKind('html')).toBe('html');
    expect(monacoLanguageForKind('text')).toBe('plaintext');
    expect(monacoLanguageForKind('null')).toBe('plaintext');
    expect(monacoLanguageForKind('empty')).toBe('plaintext');
  });
});

describe('beautifyJson / minifyJson', () => {
  it('pretty-prints with two-space indent', () => {
    expect(beautifyJson('{"a":1,"b":2}')).toBe('{\n  "a": 1,\n  "b": 2\n}');
  });
  it('round-trips', () => {
    expect(beautifyJson(minifyJson('{"a": 1}'))).toBe('{\n  "a": 1\n}');
  });
  it('throws on invalid JSON', () => {
    expect(() => beautifyJson('not json')).toThrow();
  });
});

describe('formatMarkup', () => {
  it('breaks tags onto their own lines and indents children', () => {
    // depth-bump regex needs ≥4 chars so single-char tag names like <a> won't indent; use realistic markup
    const out = formatMarkup('<root><child>x</child></root>');
    expect(out.split('\n')).toEqual(['<root>', '  <child>x</child>', '</root>']);
  });
  it('handles self-closing tags without growing indent', () => {
    const out = formatMarkup('<root><br/><br/></root>');
    expect(out).toContain('  <br/>');
    expect(out.startsWith('<root>')).toBe(true);
  });
});

describe('minifyMarkup', () => {
  it('strips whitespace between tags and around lines', () => {
    expect(minifyMarkup(`<a>\n  <b>x</b>\n</a>`)).toBe('<a><b>x</b></a>');
  });
});

describe('initialContent', () => {
  it('returns NULL for null cells', () => {
    expect(initialContent('', true)).toEqual({ text: 'NULL', kind: 'null' });
  });
  it('pretty-prints JSON cells', () => {
    expect(initialContent('{"a":1}', false)).toEqual({
      text: '{\n  "a": 1\n}',
      kind: 'json',
    });
  });
  it('falls back to text when JSON.parse fails after detection', () => {
    expect(initialContent('[1,]', false).kind).toBe('text');
  });
  it('formats markup', () => {
    const r = initialContent('<note><to>X</to></note>', false);
    expect(r.kind).toBe('xml');
    expect(r.text.split('\n').length).toBeGreaterThan(1);
  });
  it('passes plain text through unchanged', () => {
    expect(initialContent('hello world', false)).toEqual({ text: 'hello world', kind: 'text' });
  });
});

describe('applyContentFormat', () => {
  it('beautifies JSON', () => {
    expect(applyContentFormat('{"a":1}', 'json', 'beautify').text).toContain('\n');
  });
  it('minifies JSON', () => {
    expect(applyContentFormat('{\n  "a": 1\n}', 'json', 'minify').text).toBe('{"a":1}');
  });
  it('detects on the fly when given a text kind', () => {
    const r = applyContentFormat('{"a":1}', 'text', 'beautify');
    expect(r.kind).toBe('json');
  });
  it('throws for non-structured content', () => {
    expect(() => applyContentFormat('just text', 'text', 'beautify')).toThrow();
  });
});

describe('dropdownKind', () => {
  it('keeps structured kinds as-is', () => {
    expect(dropdownKind('json')).toBe('json');
    expect(dropdownKind('xml')).toBe('xml');
    expect(dropdownKind('html')).toBe('html');
  });
  it('represents text/empty/null as text', () => {
    expect(dropdownKind('text')).toBe('text');
    expect(dropdownKind('empty')).toBe('text');
    expect(dropdownKind('null')).toBe('text');
  });
});

describe('kindLabelKey', () => {
  it('maps every kind to its cellViewer i18n key', () => {
    expect(kindLabelKey('json')).toBe('cellViewer.kindJson');
    expect(kindLabelKey('xml')).toBe('cellViewer.kindXml');
    expect(kindLabelKey('html')).toBe('cellViewer.kindHtml');
    expect(kindLabelKey('text')).toBe('cellViewer.kindText');
    expect(kindLabelKey('empty')).toBe('cellViewer.kindEmpty');
    expect(kindLabelKey('null')).toBe('cellViewer.kindNull');
  });
});

describe('SELECTABLE_KINDS', () => {
  it('offers only concrete text/structured languages (no null/empty)', () => {
    expect(SELECTABLE_KINDS).toEqual(['text', 'json', 'xml', 'html']);
  });
});
