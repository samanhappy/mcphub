import { parseOAuthRelayForm } from '../../frontend/src/utils/oauthRelayForm';
import { getServerConfigPermissionError } from '../../frontend/src/utils/serverPermissions';

const metadata = {
  issuer: 'http://broker.internal',
  authorization_endpoint: 'http://broker.internal/authorize',
  token_endpoint: 'http://broker.internal/token',
  response_types_supported: ['code'],
  code_challenge_methods_supported: ['S256'],
};
it('parses origins and preserves additional broker metadata', () => {
  const config = parseOAuthRelayForm(
    'https://login.example.com\nhttps://other.example.com\nhttps://login.example.com',
    JSON.stringify(metadata),
  );
  expect(config.authorizationRelay.allowedRedirectOrigins).toEqual([
    'https://login.example.com',
    'https://other.example.com',
  ]);
  expect(config.authorizationServerMetadata).toEqual(metadata);
  expect(
    getServerConfigPermissionError({ url: 'http://broker.internal/mcp', oauth: config }, false),
  ).toBe('server.oauth.relayRequiresAdmin');
  expect(
    getServerConfigPermissionError({ url: 'http://broker.internal/mcp', oauth: config }, true),
  ).toBeNull();
});
it.each([
  '',
  'http://login.example.com',
  'https://login.example.com/path',
  'https://login.example.com/',
  'https://user:secret@login.example.com',
  'not-a-url',
  Array.from({ length: 17 }, (_, i) => `https://login${i}.example.com`).join('\n'),
])('rejects invalid origins %s', (origins) => {
  expect(() => parseOAuthRelayForm(origins, JSON.stringify(metadata))).toThrow(
    'relayOriginsInvalid',
  );
});
it.each([
  '',
  '{',
  '{}',
  JSON.stringify({ ...metadata, token_endpoint: 'file:///secret' }),
  JSON.stringify({ ...metadata, authorization_endpoint: 'http://broker.internal/authorize?q=1' }),
  JSON.stringify({ ...metadata, response_types_supported: [] }),
])('rejects incomplete or malformed metadata %s', (value) => {
  expect(() => parseOAuthRelayForm('https://login.example.com', value)).toThrow(
    'relayMetadataInvalid',
  );
});
