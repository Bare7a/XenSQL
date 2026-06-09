import { useEffect, useState } from 'react';
import { type AppTheme, getEffectiveTheme, subscribeThemeChanged } from '@/shared/lib/theme';

export function useAppTheme(): AppTheme {
  const [theme, setTheme] = useState<AppTheme>(() => getEffectiveTheme());

  useEffect(() => subscribeThemeChanged(setTheme), []);

  return theme;
}
