import { useEffect, useState } from 'react';
import {
  getEffectiveUiZoomPx,
  subscribeUiZoomChanged,
} from '@/shared/lib/uiZoom';

export function useUiZoom(): number {
  const [px, setPx] = useState(() => getEffectiveUiZoomPx());

  useEffect(() => subscribeUiZoomChanged(setPx), []);

  return px;
}
