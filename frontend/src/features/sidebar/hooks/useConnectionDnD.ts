import { useState } from 'react';

interface DnDOptions {
  reorderConnections: (fromId: string, toId: string) => void;
  moveToFolder: (connId: string, folderId: string) => void;
}

export function useConnectionDnD({ reorderConnections, moveToFolder }: DnDOptions) {
  const [dragConnId, setDragConnId] = useState<string | null>(null);
  const [dropConnId, setDropConnId] = useState<string | null>(null);
  const [dropFolderId, setDropFolderId] = useState<string | null>(null);

  const connectionDragProps = (c: { id: string }) => ({
    onDragStart: (e: React.DragEvent) => {
      setDragConnId(c.id);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', c.id);
    },
    onDragEnd: () => {
      setDragConnId(null);
      setDropConnId(null);
      setDropFolderId(null);
    },
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dropConnId !== c.id) setDropConnId(c.id);
    },
    onDragLeave: () => {
      if (dropConnId === c.id) setDropConnId(null);
    },
    onDrop: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      const fromId = e.dataTransfer.getData('text/plain');
      if (fromId && fromId !== c.id) reorderConnections(fromId, c.id);
      setDragConnId(null);
      setDropConnId(null);
    },
  });

  const folderDropProps = (f: { id: string }) => ({
    onDragOver: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      if (dropFolderId !== f.id) setDropFolderId(f.id);
    },
    onDragLeave: () => {
      if (dropFolderId === f.id) setDropFolderId(null);
    },
    onDrop: (e: React.DragEvent) => {
      if (e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      const fromId = e.dataTransfer.getData('text/plain');
      if (fromId) void moveToFolder(fromId, f.id);
      setDragConnId(null);
      setDropConnId(null);
      setDropFolderId(null);
    },
  });

  return { dragConnId, dropConnId, dropFolderId, connectionDragProps, folderDropProps };
}
