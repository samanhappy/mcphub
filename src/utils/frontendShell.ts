import fs from 'fs';
import path from 'path';
import type { ResourceTarget } from './oauthConsentResource.js';
import { logger } from './logger.js';

/**
 * Shared holder for the frontend dist directory.
 *
 * `AppServer.findAndServeFrontend()` discovers the built SPA at startup and
 * registers it here so server-rendered endpoints (e.g. the OAuth consent
 * screen) can boot the SPA shell with extra context injected. Kept out of
 * `server.ts` to avoid the controller depending on the server class.
 */
let frontendDistPath: string | null = null;

export const setFrontendDistPath = (value: string | null): void => {
  frontendDistPath = value;
};

export const getFrontendDistPath = (): string | null => frontendDistPath;

/**
 * RFC 7591 client metadata surfaced on the consent screen as trust signals.
 */
export type ConsentClientInfo = {
  clientUri?: string;
  policyUri?: string;
  tosUri?: string;
  logoUri?: string;
  contacts?: string[];
  applicationType?: string;
};

/**
 * Data the OAuth consent screen needs to render. This is the security-relevant
 * payload the server hands to the React SPA: the server has already validated
 * the request and resolved the authenticated user before this is built, and the
 * SPA only renders what it is given.
 */
export type OAuthConsentContext = {
  clientName: string;
  scopes: { name: string; description: string }[];
  // Fields echoed back on the POST to /oauth/authorize so the decision is bound
  // to the exact request that was authorized.
  clientId: string;
  redirectUri: string;
  responseType: string;
  scope: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  token?: string;
  // RFC 8707 `resource` — which MCPHub target the client wants to access.
  resource?: ResourceTarget;
  // RFC 7591 client identity / trust metadata (populated when registered).
  client?: ConsentClientInfo;
};

/**
 * Escape a value for use inside a double-quoted HTML attribute.
 */
function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Inject the OAuth consent context into the built SPA shell and return the
 * resulting HTML document, or `null` when no frontend build is available.
 *
 * Two things must be injected:
 *
 * - A `<base>` element as the first child of `<head>`. The SPA's built
 *   `index.html` references assets with relative paths (`./assets/...`), which
 *   resolve against the current URL. `/oauth/authorize` lives in a non-root
 *   directory, so without `<base>` every asset request would 404. The base
 *   must be the first element in `<head>` so it applies to the script/link
 *   tags that follow it.
 *
 * - The consent context as an inline script (`</script>` is neutralized to
 *   avoid breaking out of the script element). The SPA reads it from
 *   `window.__OAUTH_CONSENT_CONTEXT__` when rendering the consent page.
 */
export function injectOAuthConsentShell(context: OAuthConsentContext): string | null {
  if (!frontendDistPath) {
    return null;
  }

  const indexPath = path.join(frontendDistPath, 'index.html');
  if (!fs.existsSync(indexPath)) {
    return null;
  }

  let html: string;
  try {
    html = fs.readFileSync(indexPath, 'utf8');
  } catch (error) {
    logger.warn('Failed to read frontend index.html for OAuth consent shell:', error);
    return null;
  }

  // BASE_PATH mirrors src/config/index.ts (the only source of basePath).
  const basePath = process.env.BASE_PATH || '';
  const baseHref = `${basePath}/`;
  const baseTag = `<base href="${escapeHtmlAttribute(baseHref)}">`;

  // Neutralize `</script>` / `<!--` so the serialized context cannot break out
  // of the inline script element.
  const safeJson = JSON.stringify(context).replace(/</g, '\\u003c');
  const contextScript = `<script>window.__OAUTH_CONSENT_CONTEXT__ = ${safeJson};</script>`;

  // `<base>` must precede every relative resource reference, so place it
  // directly after the opening <head> tag (index.html uses a plain `<head>`).
  const headRe = /<head([^>]*)>/i;
  const headMatch = html.match(headRe);
  if (headMatch) {
    const headTag = headMatch[0];
    html = html.replace(headTag, `${headTag}${baseTag}`);
  }

  // Inject the context script at the end of <head>, before the deferred module
  // entry executes, so the SPA always sees it after boot.
  const headCloseRe = /<\/head>/i;
  const headCloseMatch = html.match(headCloseRe);
  if (headCloseMatch) {
    html = html.replace(headCloseRe, `${contextScript}</head>`);
  } else {
    // Defensive: no closing head tag, append before </body>.
    html = html.replace(/<\/body>/i, `${contextScript}</body>`);
  }

  return html;
}
