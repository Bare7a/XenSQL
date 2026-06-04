import type { ConnectionConfig } from '@/types';

export function basename(path: string): string {
  return (path || '').split(/[/\\]/).pop() || '';
}

export function connectionSubtitle(c: ConnectionConfig): string {
  if (c.driver === 'sqlite') {
    const file = basename(c.filePath || '');
    return file ? `sqlite · ${file}` : 'sqlite';
  }
  const where = [c.host, c.database].filter(Boolean).join('/');
  return where ? `${c.driver} · ${where}` : c.driver;
}
