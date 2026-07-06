import React from 'react';
import { createRoot } from 'react-dom/client';

import '@fontsource/fira-code/400.css';
import '@fontsource/fira-code/500.css';
import '@fontsource/fira-code/600.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';

import App from '@/App';
import { initMonaco } from '@/features/editor/lib/monacoSetup';
import { initI18n } from '@/i18n';
import { loadAppFonts } from '@/shared/lib/appFonts';
import { isMac } from '@/shared/lib/platform';
import { hydrateSettings } from '@/shared/lib/settingsStore';
import { initTheme } from '@/shared/lib/theme';
import { initUiZoom } from '@/shared/lib/uiZoom';

// Load settings from Go before init/render so theme/language/zoom are correct on
// the first paint and read synchronously after.
async function bootstrap() {
  await hydrateSettings();

  initI18n();
  initTheme();
  document.documentElement.classList.toggle('platform-mac', isMac);
  const uiZoomPx = initUiZoom();

  // Keep the index.html splash visible until fonts are ready so Monaco never
  // caches fallback metrics and the UI does not flash wrong typography.
  await loadAppFonts(uiZoomPx);

  initMonaco();

  const container = document.getElementById('root');
  if (container) {
    const root = createRoot(container);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  }

  hideLoadingSplash();
}

// Fade out the index.html splash once the app has painted (so #root isn't blank).
function hideLoadingSplash() {
  const el = document.getElementById('app-loading');
  if (!el) return;
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      el.classList.add('is-hidden');
      el.addEventListener('transitionend', () => el.remove(), { once: true });
      // Fallback in case the transition never fires.
      setTimeout(() => el.remove(), 400);
    }),
  );
}

void bootstrap();
