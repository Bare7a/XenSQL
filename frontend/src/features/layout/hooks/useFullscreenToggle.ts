import { WindowFullscreen, WindowIsFullscreen, WindowUnfullscreen } from '@wails/runtime/runtime';
import { useCallback } from 'react';

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
