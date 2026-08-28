import type { OpenAPIDeclaredSecurity, ServerFormData } from '../types';

/**
 * OpenAPI import security prefill (#1077).
 *
 * When a spec declares a security scheme, the import form can prefill the
 * structural fields (type, scheme, key name/location) and leave the secret for
 * the user. The contract is "prefill only, never overwrite": a security
 * section the user has touched is left alone, and any divergence from what the
 * spec declares is surfaced as a warning instead.
 */

export type OpenApiSecurityNoticeKind = 'info' | 'warning';

export interface OpenApiSecurityNotice {
  kind: OpenApiSecurityNoticeKind;
  /** i18n key under `server.openapi.*`. */
  messageKey:
    | 'securityPrefillNotice'
    | 'securityMismatchWarning'
    | 'securityUnsupportedNotice'
    | 'securityNotDeclared';
  values: Record<string, string>;
}

// True when the security section is still at its untouched defaults (no type
// selected, no value fields filled). This is the only state under which the
// spec's declared scheme may be prefilled.
export function isOpenApiSecurityUntouched(formData: ServerFormData, userTouched = false): boolean {
  if (userTouched) {
    return false;
  }

  const openapi = formData.openapi;
  if (openapi && openapi.securityType && openapi.securityType !== 'none') {
    return false;
  }
  return (
    !openapi?.apiKeyValue &&
    !openapi?.httpCredentials &&
    !openapi?.oauth2TokenUrl &&
    !openapi?.oauth2ClientId &&
    !openapi?.oauth2ClientSecret &&
    !openapi?.oauth2Token &&
    !openapi?.openIdConnectUrl &&
    !openapi?.openIdConnectToken
  );
}

// Returns a new form data with the declared scheme's structural fields filled.
// Never fills secrets, and never touches a section the user already configured.
export function applyDeclaredSecurityPrefill(
  formData: ServerFormData,
  declared: OpenAPIDeclaredSecurity,
  userTouched = false,
): ServerFormData {
  if (
    !declared.declared ||
    !declared.supported ||
    !declared.prefill ||
    !isOpenApiSecurityUntouched(formData, userTouched)
  ) {
    return formData;
  }
  const prefill = declared.prefill;
  return {
    ...formData,
    openapi: {
      ...formData.openapi,
      securityType: prefill.type,
      apiKeyName: prefill.apiKey?.name || '',
      apiKeyIn: prefill.apiKey?.in || 'header',
      apiKeyValue: '',
      httpScheme: prefill.http?.scheme || 'bearer',
      httpCredentials: '',
      oauth2TokenUrl: prefill.oauth2?.tokenUrl || '',
      oauth2ClientId: '',
      oauth2ClientSecret: '',
      oauth2Token: '',
      openIdConnectUrl: prefill.openIdConnect?.url || '',
      openIdConnectToken: '',
    },
  };
}

// Whether the user's configured security differs from what the spec declares.
// Type-level for oauth2/openIdConnect, scheme/name-level for apiKey and http
// (catches the http/basic vs http/bearer confusion from #1077).
export function securityConfigurationsDiffer(
  formData: ServerFormData,
  declared: OpenAPIDeclaredSecurity,
): boolean {
  if (!declared.prefill) {
    return false;
  }
  const openapi = formData.openapi;
  if (openapi?.securityType !== declared.prefill.type) {
    return true;
  }
  switch (openapi?.securityType) {
    case 'apiKey':
      return (
        openapi.apiKeyName !== declared.prefill.apiKey?.name ||
        openapi.apiKeyIn !== declared.prefill.apiKey?.in
      );
    case 'http':
      return openapi.httpScheme !== declared.prefill.http?.scheme;
    default:
      // oauth2 / openIdConnect: matching the type is close enough to consider
      // the configuration aligned; the endpoint fields are form details.
      return false;
  }
}

// Short human description of the user's current security selection, used in
// the mismatch warning ("…but this server is configured as …").
export function describeConfiguredSecurity(formData: ServerFormData): string | null {
  const openapi = formData.openapi;
  const type = openapi?.securityType;
  if (!type || type === 'none') {
    return null;
  }
  switch (type) {
    case 'apiKey':
      return `API key in ${openapi?.apiKeyIn || 'header'} '${openapi?.apiKeyName || ''}'`;
    case 'http':
      return `HTTP ${openapi?.httpScheme || 'bearer'}`;
    case 'oauth2':
      return 'OAuth2';
    case 'openIdConnect':
      return 'OpenID Connect';
    default:
      return null;
  }
}

// Build the notice to show next to the security section, based on the declared
// scheme and the current form state.
export function buildOpenApiSecurityNotice(
  formData: ServerFormData,
  declared: OpenAPIDeclaredSecurity | undefined,
  options: { includeNotDeclared?: boolean; securityTouched?: boolean } = {},
): OpenApiSecurityNotice | null {
  if (!declared?.declared) {
    return options.includeNotDeclared
      ? { kind: 'info', messageKey: 'securityNotDeclared', values: {} }
      : null;
  }
  if (!isOpenApiSecurityUntouched(formData, options.securityTouched)) {
    if (securityConfigurationsDiffer(formData, declared)) {
      return {
        kind: 'warning',
        messageKey: 'securityMismatchWarning',
        values: {
          summary: declared.summary,
          configured: describeConfiguredSecurity(formData) || 'none',
        },
      };
    }
  }
  if (!declared.supported) {
    return {
      kind: 'warning',
      messageKey: 'securityUnsupportedNotice',
      values: { summary: declared.summary, reason: declared.unsupportedReason || '' },
    };
  }
  return {
    kind: 'info',
    messageKey: 'securityPrefillNotice',
    values: { summary: declared.summary },
  };
}
