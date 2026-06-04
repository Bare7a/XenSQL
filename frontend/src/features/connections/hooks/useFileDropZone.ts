import { useEffect, useState } from 'react';
import { OnFileDrop, OnFileDropOff } from '@wails/runtime/runtime';

const SQLITE_EXTENSIONS = /\.(sqlite3?|db|s3db|sl3)$/i;

// Wails drop handler for SQLite files; dispatches xensql:open-sqlite CustomEvent so connections layer can subscribe without coupling to drop state.
export function useFileDropZone(): { fileDragOver: boolean } {
  const [fileDragOver, setFileDragOver] = useState(false);

  useEffect(() => {
    OnFileDrop((_x, _y, paths) => {
      setFileDragOver(false);
      const sqlitePaths = paths.filter((p) => SQLITE_EXTENSIONS.test(p));
      if (sqlitePaths.length === 0) return;
      const filePath = sqlitePaths[0];
      const fileName = filePath.split(/[/\\]/).pop() || '';
      const name = fileName.replace(/\.[^.]+$/, '');
      window.dispatchEvent(
        new CustomEvent('xensql:open-sqlite', { detail: { filePath, name } }),
      );
    }, false);

    const onDragOver = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        setFileDragOver(true);
      }
    };
    const onDragLeave = (e: DragEvent) => {
      // dragleave also fires on child-element crossings; relatedTarget null means truly left the window.
      if (e.relatedTarget === null || !(e.currentTarget as Node)?.contains(e.relatedTarget as Node)) {
        setFileDragOver(false);
      }
    };
    const onDrop = () => setFileDragOver(false);

    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      OnFileDropOff();
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
    };
  }, []);

  return { fileDragOver };
}
