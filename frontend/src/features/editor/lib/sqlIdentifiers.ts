import type { DriverType } from '@/types';

// Matches Go database.QuoteIdent.
export function quoteIdent(driver: DriverType, ident: string): string {
  switch (driver) {
    case 'postgres':
      return `"${ident.replace(/"/g, '""')}"`;
    case 'mysql':
      return `\`${ident.replace(/`/g, '``')}\``;
    default:
      return `"${ident.replace(/"/g, '""')}"`;
  }
}

export function buildQualifiedTable(driver: DriverType, schema: string, table: string): string {
  if (!schema || schema === 'main') {
    return quoteIdent(driver, table);
  }
  return `${quoteIdent(driver, schema)}.${quoteIdent(driver, table)}`;
}
