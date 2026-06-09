import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import bg from '@/i18n/locales/bg.json';
import de from '@/i18n/locales/de.json';
import en from '@/i18n/locales/en.json';
import { mirrorBootSetting, settings } from '@/shared/lib/settingsStore';
import { STORAGE_KEYS } from '@/shared/lib/storageKeys';

export const LANGUAGE_STORAGE_KEY = STORAGE_KEYS.language;

export const SUPPORTED_LANGUAGES = [
  { code: 'en', nativeName: 'English' },
  { code: 'de', nativeName: 'Deutsch' },
  { code: 'bg', nativeName: 'Български' },
] as const;

export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number]['code'];

export const DEFAULT_LANGUAGE: AppLanguage = 'en';

export function readStoredLanguage(): AppLanguage {
  try {
    const value = settings.getItem(LANGUAGE_STORAGE_KEY);
    if (value === 'en' || value === 'de' || value === 'bg') return value;
  } catch {
    /* ignore */
  }
  return DEFAULT_LANGUAGE;
}

export function getEffectiveLanguage(): AppLanguage {
  const lng = i18n.language?.split('-')[0];
  if (lng === 'en' || lng === 'de' || lng === 'bg') return lng;
  return DEFAULT_LANGUAGE;
}

export function changeLanguage(lang: AppLanguage): void {
  void i18n.changeLanguage(lang);
  document.documentElement.lang = lang;
  // Authoritative in the JSON store; mirrored to localStorage for the boot script.
  settings.setItem(LANGUAGE_STORAGE_KEY, lang);
  mirrorBootSetting(LANGUAGE_STORAGE_KEY, lang);
}

export function subscribeLanguageChanged(listener: () => void): () => void {
  const handler = () => listener();
  i18n.on('languageChanged', handler);
  return () => i18n.off('languageChanged', handler);
}

/** Use outside React (toasts, dialogs, Monaco). */
export function t(key: string, options?: Record<string, unknown>): string {
  return i18n.t(key, options);
}

export function initI18n(): void {
  if (i18n.isInitialized) return;

  const lang = readStoredLanguage();
  void i18n.use(initReactI18next).init({
    resources: {
      en: { translation: en },
      de: { translation: de },
      bg: { translation: bg },
    },
    lng: lang,
    fallbackLng: DEFAULT_LANGUAGE,
    interpolation: { escapeValue: false },
    returnEmptyString: false,
  });

  document.documentElement.lang = lang;
  // Re-sync the localStorage boot cache to the authoritative Go value on startup.
  mirrorBootSetting(LANGUAGE_STORAGE_KEY, lang);
}

export default i18n;
