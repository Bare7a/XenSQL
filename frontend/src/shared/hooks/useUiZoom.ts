import { useSyncExternalStore } from 'react';
import { getEffectiveUiZoomPx, subscribeUiZoomChanged } from '@/shared/lib/uiZoom';

export function useUiZoom(): number {
  return useSyncExternalStore(subscribeUiZoomChanged, getEffectiveUiZoomPx);
}
