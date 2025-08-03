import i18n from 'i18next';
import Backend from 'i18next-fs-backend';
import path from 'path';

// Initialize i18n for backend
const initI18n = async () => {
  return i18n.use(Backend).init({
    lng: 'en', // default language
    fallbackLng: 'en',

    backend: {
      // Path to translation files
      loadPath: path.join(process.cwd(), 'locales', '{{lng}}.json'),
    },

    interpolation: {
      escapeValue: false, // not needed for server side
    },

    // Enable debug mode for development
    debug: false,

    // Preload languages
    preload: ['en', 'zh'],

    // Use sync mode for server
    initImmediate: false,
  });
};

// Get translation function for a specific language
export const getT = (language?: string) => {
  if (language && language !== i18n.language) {
    i18n.changeLanguage(language);
  }
  return i18n.t.bind(i18n);
};

// Initialize and export
export { initI18n };
export default i18n;
