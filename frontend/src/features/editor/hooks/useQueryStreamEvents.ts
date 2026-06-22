import { Events } from '@wailsio/runtime';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '@/shared/lib/api';
import { useAppStore } from '@/store/appStore';
import type {
  ConnectionStatus,
  QueryStreamDonePayload,
  QueryStreamMetaPayload,
  QueryStreamResultPayload,
  QueryStreamRowsPayload,
} from '@/types';

// query:stream:* events for one run (streamId): meta starts a result set, rows are rAF-coalesced into
// it, result finalises it, done ends the run. A run can carry several result sets (multiple statements
// / multi-result procedures), each tagged with resultIndex.
//
// Server mode delivers these over a WebSocket and can reorder them, so each event carries a monotonic
// per-stream `seq` and we replay in seq order. Desktop is already ordered, so this is a pass-through.
export function useQueryStreamEvents(onConnectionStatusChange: (status: ConnectionStatus | null) => void): void {
  const { t } = useTranslation();
  // Refs so a language change doesn't re-run the effect and tear down the Wails listeners.
  const tRef = useRef(t);
  tRef.current = t;
  const onStatusRef = useRef(onConnectionStatusChange);
  onStatusRef.current = onConnectionStatusChange;

  useEffect(() => {
    // One buffer per tab; result sets stream sequentially, so it also tracks the current resultIndex.
    type Buffer = { streamId: string; resultIndex: number; rows: unknown[][] };
    const buffers = new Map<string, Buffer>();
    let rafId: number | null = null;

    // Per-stream reordering: hold each event by its seq and apply in order once the gap is filled.
    type Held = { run: () => void; done: boolean };
    const ordered = new Map<string, { next: number; held: Map<number, Held> }>();

    const ingest = (streamId: string, seq: number, done: boolean, run: () => void) => {
      let state = ordered.get(streamId);
      if (!state) {
        state = { next: 0, held: new Map() };
        ordered.set(streamId, state);
      }
      state.held.set(seq, { run, done });
      let h = state.held.get(state.next);
      while (h) {
        state.held.delete(state.next);
        state.next += 1;
        h.run();
        if (h.done) {
          // done is the terminal event for a stream; drop its bookkeeping.
          ordered.delete(streamId);
          break;
        }
        h = state.held.get(state.next);
      }
    };

    const flushBuffers = () => {
      rafId = null;
      const store = useAppStore.getState();
      for (const [tabId, buf] of buffers) {
        if (buf.rows.length === 0) continue;
        store.appendResultRows(tabId, buf.streamId, buf.resultIndex, buf.rows);
        buf.rows = [];
      }
    };

    const scheduleFlush = () => {
      if (rafId == null) rafId = requestAnimationFrame(flushBuffers);
    };

    const flushNow = () => {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      flushBuffers();
    };

    const unsubMeta = Events.On('query:stream:meta', (e) => {
      const payload = e.data as QueryStreamMetaPayload;
      ingest(payload.streamId, payload.seq, false, () => {
        const { tabId, streamId, resultIndex, columns, columnTypes, schemaName, tableName } = payload;
        // Each result set restarts the tab's row buffer.
        buffers.set(tabId, { streamId, resultIndex, rows: [] });
        useAppStore.getState().startResultSet(tabId, {
          streamId,
          resultIndex,
          columns,
          columnTypes,
          schemaName,
          tableName,
        });
      });
    });

    const unsubRows = Events.On('query:stream:rows', (e) => {
      const payload = e.data as QueryStreamRowsPayload;
      ingest(payload.streamId, payload.seq, false, () => {
        const { tabId, streamId, resultIndex, rows } = payload;
        let buf = buffers.get(tabId);
        if (!buf || buf.streamId !== streamId || buf.resultIndex !== resultIndex) {
          buf = { streamId, resultIndex, rows: [] };
          buffers.set(tabId, buf);
        }
        // Loop push avoids spreading huge batches onto the call stack.
        for (let i = 0; i < rows.length; i++) buf.rows.push(rows[i]);
        scheduleFlush();
      });
    });

    const unsubResult = Events.On('query:stream:result', (e) => {
      const payload = e.data as QueryStreamResultPayload;
      ingest(payload.streamId, payload.seq, false, () => {
        // Flush buffered rows before finalise so the row count can't snap ahead of visible rows.
        flushNow();
        const { tabId, streamId, resultIndex, result, statement, error } = payload;
        const cancelled = !!error && /cancel/i.test(error);
        const displayError = error ? (cancelled ? tRef.current('dialog.queryCancelled') : error) : null;
        const store = useAppStore.getState();
        store.finalizeResultSet(tabId, streamId, resultIndex, result ?? null, statement ?? null, displayError);
        // Inside an open transaction, a failed statement flips it to 'error' (only commit/rollback
        // clears it); a success clears back to 'active'. Cancels and non-transaction tabs are left alone.
        const txnState = store.getTabSession(tabId).txnState;
        if (txnState === 'active' || txnState === 'error') {
          if (error && !cancelled) {
            store.updateTabSession(tabId, { txnState: 'error' });
          } else if (!error) {
            store.updateTabSession(tabId, { txnState: 'active' });
          }
        }
      });
    });

    const unsubDone = Events.On('query:stream:done', (e) => {
      const payload = e.data as QueryStreamDonePayload;
      ingest(payload.streamId, payload.seq, true, () => {
        flushNow();
        buffers.delete(payload.tabId);

        const { tabId, streamId, connectionId, resultCount, error } = payload;
        const cancelled = !!error && /cancel/i.test(error);
        const displayError = error ? (cancelled ? tRef.current('dialog.queryCancelled') : error) : null;
        const store = useAppStore.getState();
        store.finishRun(tabId, streamId, resultCount, displayError, {
          connectionId,
          markConnected: !error,
        });
        if (tabId === store.activeTabId) {
          void api.getQueryHistory(connectionId, 50).then(store.setHistory);
          void api
            .getConnectionStatus(connectionId)
            .then(onStatusRef.current)
            .catch(() => onStatusRef.current(null));
        }
      });
    });

    return () => {
      unsubMeta();
      unsubRows();
      unsubResult();
      unsubDone();
      if (rafId != null) cancelAnimationFrame(rafId);
    };
  }, []);
}
