import { api } from '@/shared/lib/api';
import type { ExportChunk } from '@/shared/lib/exportResult';

// Also the progress granularity: progress advances once per write.
const WRITE_CHARS = 256 << 10;

export interface ChunkedWriteOptions {
  /** Cumulative rows written, between bridge calls so the UI can paint. */
  onProgress?: (rows: number) => void;
  signal?: AbortSignal;
}

export interface ChunkedWriteResult {
  rows: number;
  /** The file holds `rows` rows and is missing the format's closing text. */
  cancelled: boolean;
}

/** The first write truncates, so an empty export replaces the target. Cancelling is a result, not a
 *  throw; a write failure still rejects. */
export async function writeChunkedFile(
  path: string,
  chunks: Iterable<ExportChunk>,
  opts: ChunkedWriteOptions = {},
): Promise<ChunkedWriteResult> {
  const { onProgress, signal } = opts;
  let pending = '';
  let pendingRows = 0;
  let written = 0;
  let started = false;

  const flush = async () => {
    await api.appendTextFile(path, pending, !started);
    started = true;
    written += pendingRows;
    pending = '';
    pendingRows = 0;
    onProgress?.(written);
  };

  if (signal?.aborted) return { rows: 0, cancelled: true };
  for (const chunk of chunks) {
    if (signal?.aborted) return { rows: written, cancelled: true };
    pending += chunk.text;
    pendingRows += chunk.rows;
    if (pending.length >= WRITE_CHARS) await flush();
  }
  if (pending !== '' || !started) await flush();
  return { rows: written, cancelled: false };
}
