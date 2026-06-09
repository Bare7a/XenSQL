import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { TOOLTIP_SHOW_DELAY_MS } from '@/shared/lib/tooltip';

function positionTooltip(anchor: HTMLElement, tip: HTMLElement): void {
  tip.style.visibility = 'hidden';
  tip.removeAttribute('hidden');

  const anchorRect = anchor.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const gap = 6;
  const pad = 8;

  let top = anchorRect.bottom + gap;
  let left = anchorRect.left + anchorRect.width / 2 - tipRect.width / 2;
  left = Math.max(pad, Math.min(left, window.innerWidth - tipRect.width - pad));

  if (top + tipRect.height > window.innerHeight - pad) {
    top = anchorRect.top - tipRect.height - gap;
  }

  tip.style.top = `${Math.round(top)}px`;
  tip.style.left = `${Math.round(left)}px`;
  tip.style.visibility = 'visible';
}

export function AppTooltipLayer() {
  const tipRef = useRef<HTMLDivElement>(null);
  const anchorRef = useRef<HTMLElement | null>(null);
  const showTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const hide = () => {
      if (showTimerRef.current != null) {
        clearTimeout(showTimerRef.current);
        showTimerRef.current = null;
      }
      anchorRef.current = null;
      const tip = tipRef.current;
      if (!tip) return;
      tip.hidden = true;
      tip.textContent = '';
      tip.style.visibility = '';
    };

    const show = (anchor: HTMLElement, text: string) => {
      const tip = tipRef.current;
      if (!tip) return;
      if (!anchor.isConnected) return; // anchor was removed during the show delay - don't orphan a tooltip
      tip.textContent = text;
      positionTooltip(anchor, tip);
      anchorRef.current = anchor;
    };

    const schedule = (anchor: HTMLElement) => {
      const text = anchor.getAttribute('data-tooltip')?.trim();
      if (!text) return;
      if (anchorRef.current === anchor && showTimerRef.current == null && !tipRef.current?.hidden) {
        return;
      }
      hide();
      anchorRef.current = anchor;
      showTimerRef.current = setTimeout(() => {
        showTimerRef.current = null;
        show(anchor, text);
      }, TOOLTIP_SHOW_DELAY_MS);
    };

    const onPointerOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      const anchor = (e.target as Element).closest<HTMLElement>('[data-tooltip]');
      if (!anchor) return;
      schedule(anchor);
    };

    const onPointerOut = (e: PointerEvent) => {
      const from = (e.target as Element).closest('[data-tooltip]');
      const to = (e.relatedTarget as Element | null)?.closest('[data-tooltip]');
      if (from && from !== to) hide();
    };

    const onScroll = () => hide();

    document.addEventListener('pointerover', onPointerOver);
    document.addEventListener('pointerout', onPointerOut);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', hide);
    window.addEventListener('resize', hide);

    return () => {
      hide();
      document.removeEventListener('pointerover', onPointerOver);
      document.removeEventListener('pointerout', onPointerOut);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', hide);
      window.removeEventListener('resize', hide);
    };
  }, []);

  return createPortal(<div ref={tipRef} className="app-tooltip" role="tooltip" hidden />, document.body);
}
