// Global runtime configuration interface
export interface RuntimeConfig {
  basePath: string;
  version: string;
  name: string;
}

// RFC 8707 resource target injected by the backend.
export interface ResourceTarget {
  raw: string;
  path: string;
  kind: 'all' | 'smart' | 'target' | 'server' | 'group' | 'unknown';
  name?: string;
}

// RFC 7591 client metadata injected by the backend.
export interface ConsentClientInfo {
  clientUri?: string;
  policyUri?: string;
  tosUri?: string;
  logoUri?: string;
  contacts?: string[];
  applicationType?: string;
}

// Consent context injected by the backend into the SPA shell at
// /oauth/authorize. The server has already validated the OAuth request and
// resolved the authenticated user before building this; the SPA only renders
// what it is given and echoes the fields back on the decision POST.
export interface OAuthConsentContext {
  clientName: string;
  scopes: { name: string; description: string }[];
  clientId: string;
  redirectUri: string;
  responseType: string;
  scope: string;
  state?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
  token?: string;
  resource?: ResourceTarget;
  client?: ConsentClientInfo;
}

// Extend Window interface to include runtime config
declare global {
  interface Window {
    __MCPHUB_CONFIG__?: RuntimeConfig;
    __OAUTH_CONSENT_CONTEXT__?: OAuthConsentContext;
  }
}

export {};
