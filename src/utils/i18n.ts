import i18n from 'i18next';
import Backend from 'i18next-fs-backend';
import path from 'path';
import fs from 'fs';

// Discover available languages from the locales directory so shipped translation
// files are reachable without maintaining a hardcoded whitelist here.
const localesDir = path.join(process.cwd(), 'locales');
const discoverSupportedLanguages = (): string[] => {
  try {
    const languages = fs
      .readdirSync(localesDir)
      .filter((file) => file.endsWith('.json'))
      .map((file) => path.basename(file, '.json'));
    // Fall back to English if the directory exists but has no locale files,
    // so i18next preloading and resolution always have a usable language.
    return languages.length > 0 ? languages : ['en'];
  } catch {
    return ['en'];
  }
};

const supportedLanguages = discoverSupportedLanguages();

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

    // Preload all discovered languages
    preload: supportedLanguages,

    // Use sync mode for server
    initImmediate: false,
  });
};

// Resolve a language code to a supported language. Matching is case-insensitive
// so client requests like `zh-tw` or `ZH-TW` resolve to a mixed-case locale file
// such as `zh-TW.json`. Falls back to the base language (e.g. zh-TW -> zh) when
// no region-specific locale file exists, and finally to English. Exported so
// the middleware can normalize without duplicating the whitelist or stripping
// region codes itself.
export const resolveLanguage = (language?: string): string => {
  if (!language) {
    return 'en';
  }

  const normalized = language.trim().toLowerCase();
  const exactMatch = supportedLanguages.find(
    (lang) => lang.toLowerCase() === normalized,
  );
  if (exactMatch) {
    return exactMatch;
  }

  const base = normalized.split('-')[0];
  const baseMatch = supportedLanguages.find(
    (lang) => lang.toLowerCase() === base,
  );
  if (baseMatch) {
    return baseMatch;
  }

  return 'en';
};

// Get a translation function bound to a specific language. Uses getFixedT() so
// concurrent requests with different languages do not race by mutating the
// shared i18n instance's language.
export const getT = (language?: string) => {
  const resolved = resolveLanguage(language);
  return i18n.getFixedT(resolved);
};

// Initialize and export
export { initI18n };
export default i18n;
