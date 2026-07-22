import i18n from 'i18next';
import bg from '@/i18n/locales/bg.json';
import de from '@/i18n/locales/de.json';
import en from '@/i18n/locales/en.json';

// Node has no DOM; init i18n so SQL helpers that call t() resolve English copy.
if (!i18n.isInitialized) {
  await i18n.init({
    resources: {
      en: { translation: en },
      de: { translation: de },
      bg: { translation: bg },
    },
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    returnEmptyString: false,
  });
}
