import { useSyncExternalStore } from 'react';
import { type AppTheme, getEffectiveTheme, subscribeThemeChanged } from '@/shared/lib/theme';

export function useAppTheme(): AppTheme {
  return useSyncExternalStore(subscribeThemeChanged, getEffectiveTheme);
}
