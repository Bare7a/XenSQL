// Replays per-stream events in contiguous seq order. In Wails server mode query:stream:* events can
// arrive out of order; each carries a monotonic per-stream seq (meta=0, then rows/result/done), so an
// event is held until the expected seq arrives, then applied in order. Desktop is already ordered, so
// this is a pass-through. Per-stream state is created on the first event and dropped once `done` applies.

interface StreamState {
  next: number;
  held: Map<number, { run: () => void; done: boolean }>;
}

export interface StreamReorder {
  /**
   * Buffer an event by its seq, then run every contiguous event from `next` in order. `done` marks
   * the terminal event: the stream's state is dropped once it runs (so a reused id starts fresh).
   */
  ingest(streamId: string, seq: number, done: boolean, run: () => void): void;
}

export function createStreamReorder(): StreamReorder {
  const streams = new Map<string, StreamState>();
  return {
    ingest(streamId, seq, done, run) {
      let state = streams.get(streamId);
      if (!state) {
        state = { next: 0, held: new Map() };
        streams.set(streamId, state);
      }
      state.held.set(seq, { run, done });
      let entry = state.held.get(state.next);
      while (entry) {
        state.held.delete(state.next);
        state.next += 1;
        entry.run();
        if (entry.done) {
          streams.delete(streamId);
          break;
        }
        entry = state.held.get(state.next);
      }
    },
  };
}
