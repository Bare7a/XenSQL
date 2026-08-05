import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/shared/lib/api';
import { writeChunkedFile } from '@/shared/lib/exportFile';
import type { ExportChunk } from '@/shared/lib/exportResult';

// Stands in for the file on disk, replaying truncate/append the way the Go side would.
function fakeFile() {
  const calls: { chunk: string; truncate: boolean }[] = [];
  let contents = 'stale contents';
  vi.spyOn(api, 'appendTextFile').mockImplementation(async (_path, chunk, truncate) => {
    calls.push({ chunk, truncate });
    contents = truncate ? chunk : contents + chunk;
  });
  return {
    calls,
    get contents() {
      return contents;
    },
  };
}

const chunk = (text: string, rows: number): ExportChunk => ({ text, rows });
// Large enough to force a flush on its own (WRITE_CHARS is 256 KB).
const bigChunk = (char: string, rows: number) => chunk(char.repeat(256 << 10), rows);

describe('writeChunkedFile', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('writes a small export as a single truncating call', async () => {
    const file = fakeFile();
    const res = await writeChunkedFile('/tmp/out.csv', [chunk('a,b', 0), chunk('\n1,2', 1)]);
    expect(file.calls).toEqual([{ chunk: 'a,b\n1,2', truncate: true }]);
    expect(res).toEqual({ rows: 1, cancelled: false });
  });

  it('truncates once and appends after, so chunks concatenate in order', async () => {
    const file = fakeFile();
    const res = await writeChunkedFile('/tmp/out.csv', [bigChunk('a', 10), bigChunk('b', 10), chunk('tail', 5)]);
    expect(file.calls.length).toBeGreaterThan(1);
    expect(file.calls[0].truncate).toBe(true);
    expect(file.calls.slice(1).every((c) => !c.truncate)).toBe(true);
    expect(file.contents).toBe(`${'a'.repeat(256 << 10)}${'b'.repeat(256 << 10)}tail`);
    expect(res).toEqual({ rows: 25, cancelled: false });
  });

  // Otherwise an empty export would leave whatever the file held before.
  it('still truncates when there is nothing to write', async () => {
    const file = fakeFile();
    const res = await writeChunkedFile('/tmp/out.csv', []);
    expect(file.calls).toEqual([{ chunk: '', truncate: true }]);
    expect(file.contents).toBe('');
    expect(res).toEqual({ rows: 0, cancelled: false });
  });

  it('propagates a write failure instead of reporting success', async () => {
    vi.spyOn(api, 'appendTextFile').mockRejectedValue(new Error('disk full'));
    await expect(writeChunkedFile('/tmp/out.csv', [chunk('x', 1)])).rejects.toThrow('disk full');
  });

  describe('progress', () => {
    it('reports the cumulative rows on disk, once per write', async () => {
      fakeFile();
      const seen: number[] = [];
      await writeChunkedFile('/tmp/out.csv', [bigChunk('a', 10), bigChunk('b', 20), chunk('tail', 5)], {
        onProgress: (rows) => seen.push(rows),
      });
      expect(seen).toEqual([10, 30, 35]);
    });

    it('reports once for an export small enough to be a single write', async () => {
      fakeFile();
      const seen: number[] = [];
      await writeChunkedFile('/tmp/out.csv', [chunk('a', 3)], { onProgress: (rows) => seen.push(rows) });
      expect(seen).toEqual([3]);
    });
  });

  describe('cancellation', () => {
    it('stops writing and reports the rows that made it', async () => {
      const file = fakeFile();
      const controller = new AbortController();
      // Abort once the first write lands.
      const res = await writeChunkedFile('/tmp/out.csv', [bigChunk('a', 10), bigChunk('b', 20), chunk('tail', 5)], {
        onProgress: () => controller.abort(),
        signal: controller.signal,
      });
      expect(res).toEqual({ rows: 10, cancelled: true });
      expect(file.calls).toHaveLength(1);
      expect(file.contents).toBe('a'.repeat(256 << 10));
    });

    it('reports cancelled rather than throwing, so callers can message it', async () => {
      fakeFile();
      const controller = new AbortController();
      controller.abort();
      const res = await writeChunkedFile('/tmp/out.csv', [chunk('x', 1)], { signal: controller.signal });
      expect(res).toEqual({ rows: 0, cancelled: true });
    });

    // A generator is lazy: aborting must stop pulling from it, not just stop writing.
    it('stops pulling chunks from the generator', async () => {
      fakeFile();
      const controller = new AbortController();
      let pulled = 0;
      function* chunks(): Generator<ExportChunk> {
        for (let i = 0; i < 100; i++) {
          pulled++;
          yield bigChunk('a', 1);
        }
      }
      await writeChunkedFile('/tmp/out.csv', chunks(), {
        onProgress: () => controller.abort(),
        signal: controller.signal,
      });
      expect(pulled).toBe(2);
    });
  });
});
