/** Collapses whitespace/newlines to a single space, then truncates with ellipsis. */
export function oneLinePreview(sql: string | undefined, max = 120): string {
  const s = (sql ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
