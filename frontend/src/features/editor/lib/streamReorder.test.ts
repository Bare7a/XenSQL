import { describe, expect, it } from 'vitest';
import { createStreamReorder } from '@/features/editor/lib/streamReorder';

// Ingest a list of events for one stream and record the seqs in the order they're applied.
function applied(events: Array<{ seq: number; done?: boolean }>, streamId = 's'): number[] {
  const reorder = createStreamReorder();
  const order: number[] = [];
  for (const e of events) {
    reorder.ingest(streamId, e.seq, e.done ?? false, () => order.push(e.seq));
  }
  return order;
}

describe('createStreamReorder', () => {
  it('applies in-order events immediately and unchanged (desktop pass-through)', () => {
    expect(applied([{ seq: 0 }, { seq: 1 }, { seq: 2 }, { seq: 3, done: true }])).toEqual([0, 1, 2, 3]);
  });

  it('reorders out-of-order arrivals back into seq order (server mode)', () => {
    expect(applied([{ seq: 2 }, { seq: 0 }, { seq: 3, done: true }, { seq: 1 }])).toEqual([0, 1, 2, 3]);
  });

  it('holds events until the missing seq fills the gap', () => {
    const reorder = createStreamReorder();
    const order: number[] = [];
    reorder.ingest('s', 1, false, () => order.push(1));
    reorder.ingest('s', 2, false, () => order.push(2));
    expect(order).toEqual([]); // nothing applies while seq 0 is missing
    reorder.ingest('s', 0, false, () => order.push(0));
    expect(order).toEqual([0, 1, 2]); // gap fills → all drain in order
  });

  it('never applies anything until seq 0 arrives (every stream starts at 0)', () => {
    expect(applied([{ seq: 1 }, { seq: 2, done: true }])).toEqual([]);
  });

  it('keeps concurrent streams independent', () => {
    const reorder = createStreamReorder();
    const order: string[] = [];
    reorder.ingest('a', 1, false, () => order.push('a1'));
    reorder.ingest('b', 0, false, () => order.push('b0'));
    reorder.ingest('a', 0, false, () => order.push('a0'));
    reorder.ingest('b', 1, true, () => order.push('b1'));
    expect(order).toEqual(['b0', 'a0', 'a1', 'b1']);
  });

  it('drops state after done, so a reused stream id runs a fresh cycle (no leak/stall)', () => {
    const reorder = createStreamReorder();
    const order: number[] = [];
    const cycle = (base: number) => {
      reorder.ingest('s', 0, false, () => order.push(base));
      reorder.ingest('s', 1, true, () => order.push(base + 1));
    };
    cycle(0); // → 0, 1
    // If done hadn't reset the stream, this cycle's seq 0 would be below `next` and stall here.
    cycle(10); // → 10, 11
    expect(order).toEqual([0, 1, 10, 11]);
  });
});
