import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
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

  let separatorCount = 0;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the onClick only stops propagation to ancestor handlers; it performs no action. Items are activated via the menuitem buttons and the menu closes on Escape (useModalEscape).
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      style={{ left: pos.left, top: pos.top }}
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((item) => {
        if (item.separator) {
          separatorCount += 1;
          return <div key={`separator-${separatorCount}`} className="context-menu-separator" />;
        }
        return (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            className={cx(
              'context-menu-item',
              item.disabled && 'context-menu-item--disabled',
              item.active && 'context-menu-item--active',
            )}
            disabled={item.disabled}
            onClick={() => {
              item.action();
              onClose();
            }}
          >
            {item.icon != null && <span className="context-menu-item-icon">{item.icon}</span>}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
