import { z } from 'zod';

const endpoint = z.url().refine((value) => {
  const url = new URL(value);
  return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash;
});
const metadataSchema = z
  .object({
    issuer: endpoint.refine((value) => !new URL(value).search),
    authorization_endpoint: endpoint.refine((value) => !new URL(value).search),
    token_endpoint: endpoint,
    response_types_supported: z.array(z.string()).min(1),
  })
  .passthrough();

export const parseOAuthRelayForm = (originsText: string, metadataText: string) => {
  const origins = [...new Set(originsText.split(/\s+/).filter(Boolean))];
  if (
    !origins.length ||
    origins.length > 16 ||
    origins.some((value) => {
      try {
        const url = new URL(value);
        return url.protocol !== 'https:' || url.origin !== value;
      } catch {
        return true;
      }
    })
  )
    throw new Error('server.oauth.relayOriginsInvalid');
  let metadata;
  try {
    metadata = metadataSchema.parse(JSON.parse(metadataText));
  } catch {
    throw new Error('server.oauth.relayMetadataInvalid');
  }
  return {
    authorizationRelay: { allowedRedirectOrigins: origins },
    authorizationServerMetadata: metadata,
  };
};
