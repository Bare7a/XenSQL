import type { ConnectionConfig } from '@/types';
import { isSqliteFamily } from '@/types';

export function basename(path: string): string {
  return (path || '').split(/[/\\]/).pop() || '';
}

export function connectionSubtitle(c: ConnectionConfig): string {
  if (isSqliteFamily(c.driver)) {
    // A synced Turso connection is identified by its remote, not by the local replica file.
    const where = c.driver === 'turso' && c.remoteUrl ? remoteLabel(c.remoteUrl) : basename(c.filePath || '');
    return where ? `${c.driver} · ${where}` : c.driver;
  }
  const where = [c.host, c.database].filter(Boolean).join('/');
  return where ? `${c.driver} · ${where}` : c.driver;
}

// remoteLabel reduces a remote URL to its host, which is what identifies a Turso database.
export function remoteLabel(remoteUrl: string): string {
  return remoteUrl.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
}
