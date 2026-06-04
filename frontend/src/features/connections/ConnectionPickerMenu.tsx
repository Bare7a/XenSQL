import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConnectionConfig } from '@/types';

interface Props {
  connections: ConnectionConfig[];
  anchorRef: React.RefObject<HTMLElement | null>;
  onPick: (connectionId: string) => void;
  onClose: () => void;
}

export function ConnectionPickerMenu({ connections, anchorRef, onPick, onClose }: Props) {
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('mousedown', onMouseDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('mousedown', onMouseDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [onClose]);

  // null until measured, so the menu stays hidden instead of flashing at (0,0) on the first frame.
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const rect = anchor.getBoundingClientRect();
    const menuW = menu.offsetWidth;
    const left = Math.min(rect.left, window.innerWidth - menuW - 8);
    setPos({ top: rect.bottom + 4, left });
    // Recompute when the list (and thus the menu's width) changes while open.
  }, [anchorRef, connections.length]);

  const anchor = anchorRef.current;
  if (!anchor) return null;

  return (
    <div
      ref={menuRef}
      className="conn-picker-menu"
      style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? 'visible' : 'hidden' }}
    >
      <div className="conn-picker-header">{t('app.pickConnection')}</div>
      {connections.map((c) => (
        <button
          key={c.id}
          type="button"
          className="conn-picker-item"
          onClick={() => onPick(c.id)}
        >
          <span className="connection-dot" style={{ background: c.color }} />
          <span className="conn-picker-name">{c.name}</span>
          <span className="conn-picker-driver">{c.driver}</span>
        </button>
      ))}
    </div>
  );
}
