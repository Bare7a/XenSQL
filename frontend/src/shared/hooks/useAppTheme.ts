import { useEffect, useState } from 'react';
import { getEffectiveTheme, subscribeThemeChanged, type AppTheme } from '@/shared/lib/theme';

export function useAppTheme(): AppTheme {
  const [theme, setTheme] = useState<AppTheme>(() => getEffectiveTheme());

  useEffect(() => subscribeThemeChanged(setTheme), []);

  return theme;
}
