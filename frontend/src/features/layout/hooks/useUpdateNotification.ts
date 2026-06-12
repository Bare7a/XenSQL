import { Events } from '@wailsio/runtime';
import { useEffect } from 'react';
import { t } from '@/i18n';
import { api } from '@/shared/lib/api';
import { useToastStore } from '@/store/toastStore';

// The Go background check emits "update-available" when a newer release exists;
// show a sticky toast whose action opens the full update window.
export function useUpdateNotification(): void {
  useEffect(() => {
    return Events.On('update-available', (e) => {
      const version = (e.data as { version?: string } | undefined)?.version ?? '';
      useToastStore.getState().push(t('toast.updateAvailable', { version }), 'info', 0, {
        label: t('toast.update'),
        onClick: () => void api.checkForUpdates(),
      });
    });
  }, []);
}
