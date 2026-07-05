import { Request, Response, NextFunction } from 'express';
import { getT, resolveLanguage } from '../utils/i18n.js';

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
    // Parse accept-language header: keep the primary tag (with region code intact)
    // so resolveLanguage can match a region-specific locale (e.g. zh-TW) when one
    // ships, falling back to the base language otherwise.
    const primaryLanguage = acceptLanguage.split(',')[0].split(';')[0].trim();
    detectedLanguage = primaryLanguage;
  }

  // Normalize to a supported language (exact match, then base language, then English)
  const supportedLanguage = resolveLanguage(detectedLanguage);
  (req as any).language = supportedLanguage;

  // Get a per-request translation function bound to the detected language.
  // getT uses getFixedT internally, so this never mutates the shared i18n instance.
  const t = getT(supportedLanguage);
  (req as any).t = t;

  next();
};
