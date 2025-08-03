import { Request, Response, NextFunction } from 'express';
import { getT } from '../utils/i18n.js';

/**
 * i18n middleware to detect user language and attach translation function to request
 */
export const i18nMiddleware = (req: Request, res: Response, next: NextFunction) => {
  // Detect language from various sources (prioritized)
  const acceptLanguage = req.headers['accept-language'];
  const customLanguageHeader = req.headers['x-language'] as string;
  const languageFromQuery = req.query.lang as string;

  // Default to English
  let detectedLanguage = 'en';

  // Priority order: query parameter > custom header > accept-language header
  if (languageFromQuery) {
    detectedLanguage = languageFromQuery;
  } else if (customLanguageHeader) {
    detectedLanguage = customLanguageHeader;
  } else if (acceptLanguage) {
    // Parse accept-language header and get primary language
    const primaryLanguage = acceptLanguage.split(',')[0].split('-')[0].trim();
    detectedLanguage = primaryLanguage;
  }

  // Normalize language code (ensure we support it)
  const supportedLanguages = ['en', 'zh'];
  if (!supportedLanguages.includes(detectedLanguage)) {
    detectedLanguage = 'en'; // fallback to English
  }

  // Set language in request (using any type to avoid TypeScript issues)
  (req as any).language = detectedLanguage;

  // Get translation function for the detected language
  const t = getT(detectedLanguage);
  (req as any).t = t;

  next();
};
