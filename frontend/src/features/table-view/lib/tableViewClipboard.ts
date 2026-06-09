/**
 * Multi-cell clipboard paste for the table view.
 *
 * Two pure steps: parse the clipboard text into a 2D grid, then offset that grid onto target cells
 * anchored at the cell the user is pasting into. Both are kept side-effect free so they can be unit
 * tested without a DOM or a clipboard.
 */

export interface PasteCellEdit {
  /** Index into the loaded rows (global == display in the table view). */
  rowIdx: number;
  /** Target column name (display order). */
  col: string;
  /** Pasted value; empty fields become NULL, matching single-cell paste. */
  value: string | null;
}

/**
 * Parse clipboard text into a 2D grid of raw field strings.
 *
 * Delimiter detection prefers TAB - the de-facto spreadsheet clipboard format produced by Excel,
 * Google Sheets, and our own "text" export - and only falls back to comma (our default CSV copy
 * format) when no tab is present. Both delimiters are parsed quote-aware in the RFC-4180 style: a
 * field may be wrapped in double quotes to contain the delimiter or newlines, and `""` is an escaped
 * quote. A single trailing blank line (from a trailing newline) is dropped.
 *
 * Empty fields are returned as `''`; NULL semantics are decided later in {@link computePasteEdits}.
 */
export function parseClipboardGrid(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (normalized === '') return [];

  const delimiter = normalized.includes('\t') ? '\t' : ',';
  const grid: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      grid.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  row.push(field);
  grid.push(row);

  // A trailing newline leaves a final [''] row; drop it so it doesn't paste a phantom empty cell.
  if (grid.length > 1) {
    const last = grid[grid.length - 1];
    if (last.length === 1 && last[0] === '') grid.pop();
  }
  return grid;
}

/**
 * Offset a parsed clipboard grid onto target cells anchored at (anchorRow, anchorColPos) in display
 * coordinates - e.g. a 3×3 copy pasted at B2 fills B2:D4. Cells that fall past the loaded rows or the
 * visible columns are dropped: we can't create rows here, and there's nothing to the right to fill.
 *
 * Accepts the parsed clipboard (`string[][]`) or the captured copy buffer (`(string | null)[][]`,
 * NULLs preserved); a null or empty field both paste as NULL, matching single-cell paste.
 */
export function computePasteEdits(
  grid: (string | null)[][],
  anchorRow: number,
  anchorColPos: number,
  rowCount: number,
  displayColumns: string[],
): PasteCellEdit[] {
  const edits: PasteCellEdit[] = [];
  for (let dr = 0; dr < grid.length; dr++) {
    const rowIdx = anchorRow + dr;
    if (rowIdx < 0 || rowIdx >= rowCount) continue;
    const cells = grid[dr];
    for (let dc = 0; dc < cells.length; dc++) {
      const col = displayColumns[anchorColPos + dc];
      if (col == null) continue;
      const raw = cells[dc];
      edits.push({ rowIdx, col, value: raw == null || raw === '' ? null : raw });
    }
  }
  return edits;
}
