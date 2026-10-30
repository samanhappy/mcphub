import { z } from 'zod';

const endpoint = z.url().refine((value) => {
  const url = new URL(value);
  return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && !url.hash;
}, 'Expected an HTTP(S) URL without credentials or a fragment');

// Validate file declarations too: they do not pass through the server API normalizer.
export const oauthServerMetadataSchema = z
  .object({
    issuer: endpoint.refine((value) => !new URL(value).search, 'Issuer must not contain a query'),
    authorization_endpoint: endpoint,
    token_endpoint: endpoint,
    response_types_supported: z.array(z.string()).min(1),
    code_challenge_methods_supported: z.array(z.string()).optional(),
    token_endpoint_auth_methods_supported: z.array(z.string()).optional(),
    client_id_metadata_document_supported: z.boolean().optional(),
    dpop_signing_alg_values_supported: z.array(z.string()).optional(),
    scopes_supported: z.array(z.string()).optional(),
    registration_endpoint: endpoint.optional(),
    revocation_endpoint: endpoint.optional(),
    authorization_response_iss_parameter_supported: z.boolean().optional(),
  })
  .passthrough();

export const authorizationRelaySchema = z
  .object({
    allowedRedirectOrigins: z
      .array(
        z.url().refine((value) => {
          const url = new URL(value);
          return url.protocol === 'https:' && url.origin === value;
        }, 'Expected an HTTPS origin without a path'),
      )
      .min(1)
      .max(16),
  })
  .strict();

export const validateAuthorizationRelay = (oauth: {
  identityMode?: string;
  authorizationRelay?: unknown;
  authorizationServerMetadata?: unknown;
}): void => {
  if (oauth.authorizationRelay === undefined) return;
  authorizationRelaySchema.parse(oauth.authorizationRelay);
  if (oauth.identityMode !== 'personal')
    throw new Error('Authorization relay requires personal OAuth');
  const metadata = oauthServerMetadataSchema.parse(oauth.authorizationServerMetadata);
  if (new URL(metadata.authorization_endpoint).search)
    throw new Error('Relay authorization endpoint must not contain a query');
};
