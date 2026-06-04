import { useCallback } from 'react';
import {
  WindowFullscreen,
  WindowIsFullscreen,
  WindowUnfullscreen,
} from '@wails/runtime/runtime';

export function useFullscreenToggle(): () => Promise<void> {
  return useCallback(async () => {
    const isFs = await WindowIsFullscreen();
    if (isFs) {
      WindowUnfullscreen();
    } else {
      WindowFullscreen();
    }
  }, []);
}
