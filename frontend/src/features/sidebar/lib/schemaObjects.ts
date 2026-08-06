import type {
  ConstraintInfo,
  IndexInfo,
  ObjectKind,
  ObjectRef,
  RoutineInfo,
  SchemaObjectGroup,
  TriggerInfo,
} from '@/types';

export type ObjectBadge = 'pk' | 'fk' | 'unique' | 'check' | 'index' | 'function' | 'procedure';

// The four backend shapes flattened so one component renders them all.
export interface SchemaObjectRow {
  /** Unique within its group; `name` alone isn't, since SQLite reports inline keys unnamed. */
  key: string;
  /** The object's own name, as the DDL lookup expects it. */
  name: string;
  label: string;
  detail: string;
  badge?: ObjectBadge;
  ref: ObjectRef;
}

const cols = (list: string[] | undefined) => (list?.length ? `(${list.join(', ')})` : '');

export function indexRows(indexes: IndexInfo[]): SchemaObjectRow[] {
  return indexes.map((idx) => ({
    key: idx.name,
    name: idx.name,
    label: idx.name,
    detail: cols(idx.columns),
    badge: idx.isPrimary ? 'pk' : idx.isUnique ? 'unique' : 'index',
    ref: { schema: idx.schema, name: idx.name, kind: 'index', table: idx.table },
  }));
}

// An unrecognised type (EXCLUDE) gets no badge rather than a wrong one.
function constraintBadge(type: string): ObjectBadge | undefined {
  switch (type.toUpperCase()) {
    case 'PRIMARY KEY':
      return 'pk';
    case 'FOREIGN KEY':
      return 'fk';
    case 'UNIQUE':
      return 'unique';
    case 'CHECK':
      return 'check';
    default:
      return undefined;
  }
}

function constraintDetail(c: ConstraintInfo): string {
  if (c.type.toUpperCase() === 'FOREIGN KEY') {
    const target = c.refTable ? `${c.refTable}${cols(c.refColumns)}` : '';
    return target ? `${cols(c.columns)} → ${target}` : cols(c.columns);
  }
  // A CHECK owns no key columns, so its body is all there is to show.
  if (c.type.toUpperCase() === 'CHECK') {
    return c.definition ?? '';
  }
  return cols(c.columns);
}

export function constraintRows(constraints: ConstraintInfo[]): SchemaObjectRow[] {
  return constraints.map((c) => ({
    // Two unnamed constraints of the same type can't cover the same columns, so this is unique.
    key: c.name || `${c.type}:${c.columns.join(',')}`,
    name: c.name,
    // SQLite's inline keys arrive unnamed; the type beats an empty row.
    label: c.name || c.type,
    detail: constraintDetail(c),
    badge: constraintBadge(c.type),
    ref: { schema: c.schema, name: c.name, kind: 'constraint', table: c.table },
  }));
}

export function triggerRows(triggers: TriggerInfo[]): SchemaObjectRow[] {
  return triggers.map((tr) => ({
    key: tr.name,
    name: tr.name,
    label: tr.name,
    detail: [tr.timing, tr.events].filter(Boolean).join(' '),
    ref: { schema: tr.schema, name: tr.name, kind: 'trigger', table: tr.table },
  }));
}

export function routineRows(routines: RoutineInfo[]): SchemaObjectRow[] {
  return routines.map((r) => ({
    key: r.args ? `${r.name}(${r.args})` : r.name,
    name: r.name,
    label: `${r.name}(${r.args ?? ''})`,
    detail: r.returnType ? `→ ${r.returnType}` : '',
    badge: r.kind === 'procedure' ? 'procedure' : 'function',
    ref: { schema: r.schema, name: r.name, kind: r.kind, args: r.args },
  }));
}

export const groupKey = (connectionId: string, schema: string, table: string, group: SchemaObjectGroup) =>
  `${connectionId}:${schema}:${table}:${group}`;

export const routinesKey = (connectionId: string, schema: string) => `${connectionId}:${schema}:routines`;

export const TABLE_GROUPS: SchemaObjectGroup[] = ['indexes', 'constraints', 'triggers'];

export function isViewKind(kind: ObjectKind): boolean {
  return kind === 'view' || kind === 'materialized view';
}
