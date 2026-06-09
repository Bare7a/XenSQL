export { primaryKeyKey, rowPrimaryKey } from '@/shared/lib/grid';

export const TABLE_PAGE_SIZE = 100;

export function mergeTablePage(prev: unknown[][], page: unknown[][], replace: boolean): unknown[][] {
  if (replace) return page;
  return [...prev, ...page];
}
