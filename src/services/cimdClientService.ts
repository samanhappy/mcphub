/**
 * Client ID Metadata Documents (CIMD) support for MCPHub's authorization server.
 *
 * Implements the client side of draft-ietf-oauth-client-id-metadata-document:
 * a client may present an HTTPS URL as its client_id; the authorization server
 * fetches a metadata document from that URL and uses it in place of a
 * registration. CIMD clients are always treated as PUBLIC clients (no shared
 * secret can be established out-of-band), so PKCE with S256 is enforced by the
 * existing public-client policy.
 *
 * Documents are fetched with SSRF protection (private-IP blocklist +
 * redirect validation, shared with upstream MCP connections) and cached with
 * a TTL. Resolution is opt-in via systemConfig.oauthServer.clientIdMetadata.enabled.
 */

import { getSystemConfigDao } from '../dao/index.js';
import { cloneDefaultOAuthServerConfig } from '../constants/oauthServerDefaults.js';
import { findOAuthClientById } from '../models/OAuth.js';
import { assertSafeUrl, createRedirectValidatingFetch, type SsrfLookup } from '../utils/ssrf.js';
import type { IOAuthClient } from '../types/index.js';
import { logger } from '../utils/logger.js';

const METADATA_FETCH_TIMEOUT_MS = 5_000;
const DEFAULT_CACHE_TTL_MS = 3_600_000;
const MAX_DOCUMENT_BYTES = 256 * 1024;

export const isCimdClientId = (clientId: string): boolean => {
  return typeof clientId === 'string' && clientId.startsWith('https://');
};

interface CimdDocument {
  client_id?: unknown;
  client_name?: unknown;
  redirect_uris?: unknown;
  token_endpoint_auth_method?: unknown;
  application_type?: unknown;
  contacts?: unknown;
  logo_uri?: unknown;
  client_uri?: unknown;
  policy_uri?: unknown;
  tos_uri?: unknown;
  jwks_uri?: unknown;
}

interface CacheEntry {
  client: IOAuthClient;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<IOAuthClient | undefined>>();

let fetchImpl: typeof fetch = (...args) => fetch(...args);

// Test seam: DNS resolution used by the SSRF guard, so tests never hit real DNS.
let ssrfLookupOverride: SsrfLookup | undefined;

/** Test seam: replace the fetch implementation used for metadata retrieval. */
export const setCimdFetchImplForTesting = (impl: typeof fetch): void => {
  fetchImpl = impl;
};

/** Test seam: replace DNS resolution used by the SSRF guard. */
export const setCimdDnsLookupForTesting = (lookup?: SsrfLookup): void => {
  ssrfLookupOverride = lookup;
};

export const clearCimdCacheForTesting = (): void => {
  cache.clear();
  inflight.clear();
};

interface CimdSettings {
  enabled: boolean;
  cacheTtlMs: number;
}

export const getCimdSettings = async (): Promise<CimdSettings> => {
  try {
    const systemConfig = await getSystemConfigDao().get();
    const merged = { ...cloneDefaultOAuthServerConfig(), ...systemConfig?.oauthServer };
    const ttl =
      typeof merged.clientIdMetadata?.cacheTtlMs === 'number' &&
      merged.clientIdMetadata.cacheTtlMs > 0
        ? merged.clientIdMetadata.cacheTtlMs
        : DEFAULT_CACHE_TTL_MS;
    return { enabled: merged.clientIdMetadata?.enabled === true, cacheTtlMs: ttl };
  } catch {
    return { enabled: false, cacheTtlMs: DEFAULT_CACHE_TTL_MS };
  }
};

const asStringArray = (value: unknown): string[] | undefined =>
  Array.isArray(value) && value.every((v) => typeof v === 'string') ? (value as string[]) : undefined;

/**
 * Validate a fetched metadata document and map it onto an IOAuthClient.
 * Returns undefined when the document is not a usable CIMD client.
 */
export const mapCimdDocument = (
  clientIdUrl: string,
  document: CimdDocument,
): IOAuthClient | undefined => {
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return undefined;
  }

  // The document's client_id MUST be present and identical to the URL it was
  // retrieved from (draft-ietf-oauth-client-id-metadata-document, section 4).
  if (document.client_id !== clientIdUrl) {
    return undefined;
  }

  const redirectUris = asStringArray(document.redirect_uris);
  if (!redirectUris || redirectUris.length === 0 || !redirectUris.every((uri) => uri)) {
    return undefined;
  }

  // Only public clients can be expressed via CIMD on this server; a document
  // claiming a secret-based auth method cannot be honored safely.
  const authMethod =
    typeof document.token_endpoint_auth_method === 'string'
      ? document.token_endpoint_auth_method
      : 'none';
  if (authMethod !== 'none') {
    return undefined;
  }

  const applicationType =
    document.application_type === 'native' ? ('native' as const) : ('web' as const);
  const contacts = asStringArray(document.contacts);
  const optionalUriField = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 ? value : undefined;

  return {
    clientId: clientIdUrl,
    name:
      typeof document.client_name === 'string' && document.client_name.length > 0
        ? document.client_name
        : clientIdUrl,
    redirectUris,
    grants: ['authorization_code', 'refresh_token'],
    metadata: {
      application_type: applicationType,
      ...(contacts ? { contacts } : {}),
      ...(optionalUriField(document.logo_uri) ? { logo_uri: optionalUriField(document.logo_uri) } : {}),
      ...(optionalUriField(document.client_uri) ? { client_uri: optionalUriField(document.client_uri) } : {}),
      ...(optionalUriField(document.policy_uri) ? { policy_uri: optionalUriField(document.policy_uri) } : {}),
      ...(optionalUriField(document.tos_uri) ? { tos_uri: optionalUriField(document.tos_uri) } : {}),
      ...(optionalUriField(document.jwks_uri) ? { jwks_uri: optionalUriField(document.jwks_uri) } : {}),
    },
  };
};

const fetchCimdDocument = async (clientIdUrl: string): Promise<IOAuthClient | undefined> => {
  await assertSafeUrl(clientIdUrl, {
    allowInternal: false,
    ...(ssrfLookupOverride ? { lookup: ssrfLookupOverride } : {}),
  });

  const validatingFetch = createRedirectValidatingFetch((url, init) => fetchImpl(url, init), false);
  const response = await validatingFetch(clientIdUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(METADATA_FETCH_TIMEOUT_MS),
    redirect: 'manual',
  });

  if (!response.ok) {
    logger.warn('CIMD metadata document fetch failed', {
      clientIdUrl,
      status: response.status,
    });
    return undefined;
  }

  const contentLength = Number(response.headers.get('content-length') || '0');
  if (contentLength > MAX_DOCUMENT_BYTES) {
    logger.warn('CIMD metadata document exceeds size limit', { clientIdUrl });
    return undefined;
  }

  let document: CimdDocument;
  try {
    const text = await response.text();
    if (text.length > MAX_DOCUMENT_BYTES) {
      logger.warn('CIMD metadata document exceeds size limit', { clientIdUrl });
      return undefined;
    }
    document = JSON.parse(text) as CimdDocument;
  } catch (error) {
    logger.warn('CIMD metadata document is not valid JSON', { clientIdUrl, error });
    return undefined;
  }

  const mapped = mapCimdDocument(clientIdUrl, document);
  if (!mapped) {
    logger.warn('CIMD metadata document failed validation', { clientIdUrl });
  }
  return mapped;
};

/**
 * Resolve a URL-shaped client_id to a client by fetching (or caching) its
 * metadata document. Returns undefined for anything that is not a valid,
 * enabled CIMD identifier.
 */
export const resolveCimdClient = async (
  clientId: string,
  settings?: CimdSettings,
): Promise<IOAuthClient | undefined> => {
  const resolvedSettings = settings ?? (await getCimdSettings());
  if (!resolvedSettings.enabled || !isCimdClientId(clientId)) {
    return undefined;
  }

  const now = Date.now();
  const cached = cache.get(clientId);
  if (cached && cached.expiresAt > now) {
    return cached.client;
  }

  const existingFetch = inflight.get(clientId);
  if (existingFetch) {
    return existingFetch;
  }

  const fetchPromise = fetchCimdDocument(clientId)
    .then((client) => {
      if (client) {
        cache.set(clientId, { client, expiresAt: Date.now() + resolvedSettings.cacheTtlMs });
      }
      return client;
    })
    .catch((error) => {
      logger.warn('Failed to resolve CIMD client', { clientId, error });
      return undefined;
    })
    .finally(() => {
      inflight.delete(clientId);
    });

  inflight.set(clientId, fetchPromise);
  return fetchPromise;
};

/**
 * Client lookup used across the authorization server surface: registered
 * clients first, then CIMD resolution when enabled. Drop-in replacement for
 * findOAuthClientById at every call site that must understand CIMD clients.
 */
export const findOAuthClientIncludingCimd = async (
  clientId: string,
): Promise<IOAuthClient | undefined> => {
  const persisted = await findOAuthClientById(clientId);
  if (persisted) {
    return persisted;
  }
  return resolveCimdClient(clientId);
};
