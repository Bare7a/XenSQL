import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useModalEscape } from '@/shared/hooks/useModalEscape';
import { cx } from '@/shared/lib/cx';

export interface ContextMenuItem {
  label: string;
  action: () => void;
  separator?: boolean;
  disabled?: boolean;
  /** Optional leading icon (e.g. a lucide icon with `className="icon-xs"`). */
  icon?: ReactNode;
  /** Marks the current selection (e.g. the active sort key). */
  active?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  useModalEscape(onClose);

  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  // Clamp into the viewport so an edge right-click stays on screen.
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const pad = 8;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: Math.max(pad, Math.min(x, window.innerWidth - width - pad)),
      top: Math.max(pad, Math.min(y, window.innerHeight - height - pad)),
    });
  }, [x, y]);

  // Ref keeps listeners attached once per mount instead of re-subscribing on every parent re-render.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onCloseRef.current();
    };
    window.addEventListener('mousedown', onPointerDown, true);
    window.addEventListener('contextmenu', onPointerDown, true);
    return () => {
      window.removeEventListener('mousedown', onPointerDown, true);
      window.removeEventListener('contextmenu', onPointerDown, true);
    };
  }, []);

  return (
    <div ref={menuRef} className="context-menu" style={{ left: pos.left, top: pos.top }} onClick={(e) => e.stopPropagation()}>
      {items.map((item, i) =>
        item.separator ? (
          <div key={i} className="context-menu-separator" />
        ) : (
          <div
            key={i}
            className={cx(
              'context-menu-item',
              item.disabled && 'context-menu-item--disabled',
              item.active && 'context-menu-item--active'
            )}
            onClick={() => {
              if (!item.disabled) {
                item.action();
                onClose();
              }
            }}
          >
            {item.icon != null && <span className="context-menu-item-icon">{item.icon}</span>}
            {item.label}
          </div>
        )
      )}
    </div>
  );
}
