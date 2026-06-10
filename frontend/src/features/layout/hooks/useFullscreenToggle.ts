import { Window } from '@wailsio/runtime';
import { useCallback } from 'react';

export function useFullscreenToggle(): () => Promise<void> {
  return useCallback(async () => {
    const isFs = await Window.IsFullscreen();
    if (isFs) {
      Window.UnFullscreen();
    } else {
      Window.Fullscreen();
    }
  }, []);
}
