import React from 'react';
import { createRoot } from 'react-dom/client';
import App from '@/App';
import { initMonaco } from '@/features/editor/lib/monacoSetup';
import { initI18n } from '@/i18n';
import { hydrateSettings } from '@/shared/lib/settingsStore';
import { initTheme } from '@/shared/lib/theme';
import { initUiZoom } from '@/shared/lib/uiZoom';

// Load settings from Go before init/render so theme/language/zoom are correct on
// the first paint and read synchronously after.
async function bootstrap() {
  await hydrateSettings();

  initI18n();
  initTheme();
  initUiZoom();
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
