import { describe, expect, it } from 'vitest';
import { basename, connectionSubtitle, remoteLabel } from '@/shared/lib/connectionLabel';
import type { ConnectionConfig } from '@/types';
import { DEFAULT_CONNECTION_COLOR, isSqliteFamily } from '@/types';

const conn = (patch: Partial<ConnectionConfig>): ConnectionConfig => ({
  id: '1',
  name: 'c',
  driver: 'sqlite',
  color: DEFAULT_CONNECTION_COLOR,
  ...patch,
});

describe('isSqliteFamily', () => {
  it('covers SQLite and Turso only', () => {
    expect(isSqliteFamily('sqlite')).toBe(true);
    expect(isSqliteFamily('turso')).toBe(true);
    expect(isSqliteFamily('postgres')).toBe(false);
    expect(isSqliteFamily('mysql')).toBe(false);
  });
});

describe('basename', () => {
  it('takes the file name from posix and windows paths', () => {
    expect(basename('/var/data/app.db')).toBe('app.db');
    expect(basename('C:\\data\\app.db')).toBe('app.db');
    expect(basename('')).toBe('');
  });
});

describe('remoteLabel', () => {
  it('reduces a remote URL to its host', () => {
    expect(remoteLabel('https://my-db-my-org.turso.io')).toBe('my-db-my-org.turso.io');
    expect(remoteLabel('https://my-db-my-org.turso.io/v2/pipeline')).toBe('my-db-my-org.turso.io');
    expect(remoteLabel('my-db-my-org.turso.io')).toBe('my-db-my-org.turso.io');
  });
});

describe('connectionSubtitle', () => {
  it('shows the file name for SQLite', () => {
    expect(connectionSubtitle(conn({ driver: 'sqlite', filePath: '/var/data/app.db' }))).toBe('sqlite · app.db');
    expect(connectionSubtitle(conn({ driver: 'sqlite', filePath: '' }))).toBe('sqlite');
  });

  it('shows the local file for a local Turso database', () => {
    expect(connectionSubtitle(conn({ driver: 'turso', filePath: '/var/data/app.db' }))).toBe('turso · app.db');
  });

  // A synced connection is identified by the cloud database it mirrors, not by the replica file.
  it('shows the remote host for a synced Turso database', () => {
    expect(
      connectionSubtitle(
        conn({ driver: 'turso', filePath: '/var/data/replica.db', remoteUrl: 'https://my-db-my-org.turso.io' }),
      ),
    ).toBe('turso · my-db-my-org.turso.io');
  });

  it('shows host/database for network drivers', () => {
    expect(connectionSubtitle(conn({ driver: 'postgres', host: 'localhost', database: 'blog' }))).toBe(
      'postgres · localhost/blog',
    );
    expect(connectionSubtitle(conn({ driver: 'mysql' }))).toBe('mysql');
  });
});
