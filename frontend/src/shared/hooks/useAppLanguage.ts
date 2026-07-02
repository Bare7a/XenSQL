import { useSyncExternalStore } from 'react';
import { type AppLanguage, getEffectiveLanguage, subscribeLanguageChanged } from '@/i18n';

export function useAppLanguage(): AppLanguage {
  return useSyncExternalStore(subscribeLanguageChanged, getEffectiveLanguage);
}
