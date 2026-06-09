import { type RefObject, useEffect, useRef, useState } from 'react';

/**
 * Tracks an element's pixel height (clientHeight) via ResizeObserver. Returns the ref to attach
 * and the latest measured height, seeded with `initial` until the element is first measured.
 */
export function useMeasuredHeight<T extends HTMLElement>(initial: number): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [height, setHeight] = useState(initial);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const h = el.clientHeight;
      if (h > 0) setHeight(h);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return [ref, height];
}
