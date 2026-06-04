import type { Virtualizer } from '@tanstack/react-virtual';

interface GridTableProps<TCtx> {
  /** False until column widths are measured - shows a placeholder instead of the table. */
  columnsSized: boolean;
  sizingClassName: string;
  wrapClassName: string;
  tableWrapRef: React.RefObject<HTMLDivElement | null>;
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>;
  rowHeight: number;
  colIndices: number[];
  header: React.ReactNode;
  onClearSelection: () => void;
  onContextMenu?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Per-row context built once and passed to all render callbacks, avoiding redundant index/key lookups per cell. */
  buildRowContext: (displayIdx: number) => TCtx;
  getRowKey: (displayIdx: number, ctx: NoInfer<TCtx>) => React.Key;
  getRowClassName: (displayIdx: number, ctx: NoInfer<TCtx>) => string | undefined;
  renderRowNum: (displayIdx: number, ctx: NoInfer<TCtx>) => React.ReactNode;
  /** Must emit data-row / data-col-pos for useGridCore hit-testing. */
  renderCell: (displayIdx: number, colPos: number, ci: number, ctx: NoInfer<TCtx>) => React.ReactNode;
}

export function GridTable<TCtx>({
  columnsSized,
  sizingClassName,
  wrapClassName,
  tableWrapRef,
  rowVirtualizer,
  rowHeight,
  colIndices,
  header,
  onClearSelection,
  onContextMenu,
  buildRowContext,
  getRowKey,
  getRowClassName,
  renderRowNum,
  renderCell,
}: GridTableProps<TCtx>) {
  if (!columnsSized) {
    // Ref attached during sizing so mount-time effects (useGridWheel) bind to the element.
    return <div ref={tableWrapRef} className={sizingClassName} aria-busy="true" />;
  }

  return (
    <div
      ref={tableWrapRef}
      className={wrapClassName}
      onContextMenu={onContextMenu}
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        if (target.closest('td, th')) return;
        onClearSelection();
      }}
    >
      <table className="data-table" style={{ display: 'grid' }}>
        {header}

        <tbody
          style={{
            display: 'grid',
            height: `${rowVirtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const displayIdx = virtualRow.index;
            const ctx = buildRowContext(displayIdx);
            return (
              <tr
                key={getRowKey(displayIdx, ctx)}
                className={getRowClassName(displayIdx, ctx)}
                style={{
                  display: 'flex',
                  position: 'absolute',
                  transform: `translateY(${virtualRow.start}px)`,
                  width: '100%',
                  height: `${rowHeight}px`,
                }}
              >
                {renderRowNum(displayIdx, ctx)}
                {colIndices.map((ci, colPos) => renderCell(displayIdx, colPos, ci, ctx))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
