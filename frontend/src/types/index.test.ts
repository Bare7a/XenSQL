import { describe, expect, it } from 'vitest';
import { tableViewStateFrom } from '@/types';

describe('tableViewStateFrom', () => {
  it('defaults filter, sort and hidden columns for a bare table ref', () => {
    const state = tableViewStateFrom({ schema: 'public', table: 'users' });
    expect(state).toMatchObject({
      schema: 'public',
      table: 'users',
      filter: '',
      orderBy: null,
      orderDir: 'ASC',
      hiddenColumns: [],
      rows: [],
      columns: [],
      columnTypes: [],
      primaryKeys: [],
      hasMore: false,
    });
    expect(state.pending).toEqual({ edits: {}, deletes: [] });
  });

  it('carries persisted filter, sort and hidden columns through', () => {
    const state = tableViewStateFrom({
      schema: 'main',
      table: 'employees',
      filter: 'id > 1',
      orderBy: 'name',
      orderDir: 'DESC',
      hiddenColumns: ['name', 'email'],
    });
    expect(state).toMatchObject({
      filter: 'id > 1',
      orderBy: 'name',
      orderDir: 'DESC',
      hiddenColumns: ['name', 'email'],
    });
  });
});
