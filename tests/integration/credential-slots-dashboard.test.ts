import type { ServerFormData } from '../../frontend/src/types/index.js';
import { buildServerPayload } from '../../frontend/src/utils/serverFormPayload.js';
import type { ServerConfig } from '../../src/types/index.js';
import { validateCredentialTemplate } from '../../src/utils/credentialTemplate.js';
import { normalizeServerConfigForPersistence } from '../../src/utils/serverConfigPersistence.js';

const slots = [{ target: 'headers' as const, name: 'x-api-key' }];

const buildPayload = (
  type: 'sse' | 'streamable-http',
  oauth: ServerFormData['oauth'] = { identityMode: 'shared' },
) =>
  buildServerPayload({
    formData: {
      name: 'remote',
      url: 'https://example.com/mcp',
      command: '',
      arguments: '',
      args: [],
      env: [],
      headers: [],
      credentialTemplate: slots,
      oauth,
    },
    serverType: type,
    envVars: [],
    headerVars: [],
  }).config as ServerConfig;

describe.each(['sse', 'streamable-http'] as const)('%s dashboard credential slots', (type) => {
  test('saves slots with untouched OAuth defaults and survives subsequent edits', () => {
    const payload = buildPayload(type, {
      identityMode: 'shared',
      clientId: '',
      clientSecret: '',
      scopes: '',
      accessToken: '',
      refreshToken: '',
      authorizationEndpoint: '',
      tokenEndpoint: '',
      resource: '',
    });
    expect(payload.oauth).toEqual({});
    const saved = normalizeServerConfigForPersistence(payload);
    expect(saved.credentialTemplate).toEqual(slots);
    expect(saved.oauth).toBeUndefined();

    const edited = normalizeServerConfigForPersistence(buildPayload(type));
    expect(edited.credentialTemplate).toEqual(slots);
    expect(edited.oauth).toBeUndefined();
  });

  test('accepts legacy default-only OAuth in direct validation and persistence', () => {
    const legacy = { ...buildPayload(type), oauth: { identityMode: 'shared' as const } };
    expect(validateCredentialTemplate(legacy)).toEqual(slots);
    expect(normalizeServerConfigForPersistence(legacy).credentialTemplate).toEqual(slots);
    expect(normalizeServerConfigForPersistence(legacy).oauth).toBeUndefined();
  });

  test('preserves personal OAuth mode even without client configuration', () => {
    expect(buildPayload(type, { identityMode: 'personal' }).oauth).toEqual({
      identityMode: 'personal',
    });
    expect(() =>
      normalizeServerConfigForPersistence(
        buildPayload(type, {
          identityMode: 'personal',
        }),
      ),
    ).toThrow('Personal OAuth');
  });

  test.each([
    { clientId: 'client' },
    { clientSecret: 'secret' },
    { accessToken: 'token' },
    { refreshToken: 'refresh' },
    { authorizationEndpoint: 'https://example.com/authorize' },
    { tokenEndpoint: 'https://example.com/token' },
    { resource: 'https://example.com/mcp' },
    { redirectUri: 'https://hub.example.com/callback' },
    { revocationEndpoint: 'https://example.com/revoke' },
    { scopes: [] },
    { dynamicRegistration: {} },
    { pendingAuthorization: { state: 'pending' } },
    { allowInsecureTokenEndpoint: false },
    { identityMode: 'personal' },
  ] satisfies NonNullable<ServerConfig['oauth']>[])(
    'still rejects OAuth configuration %j',
    (oauth) => {
      expect(() =>
        validateCredentialTemplate({
          ...buildPayload(type),
          oauth: { identityMode: 'shared', ...oauth },
        }),
      ).toThrow('OAuth');
    },
  );

  test('keeps real shared OAuth fields in the form payload', () => {
    const payload = buildPayload(type, { identityMode: 'shared', clientId: ' client ' });
    expect(payload.oauth).toEqual({ identityMode: 'shared', clientId: 'client' });
    expect(() => normalizeServerConfigForPersistence(payload)).toThrow('OAuth');
  });
});

test.each(['sse', 'streamable-http'] as const)(
  '%s URL slots survive dashboard persistence',
  (serverType) => {
    const credentialTemplate = [{ target: 'url' as const, name: 'region', allowed: ['us', 'eu'] }];
    const payload = buildServerPayload({
      formData: {
        name: 'regional',
        url: 'https://mcp.{{url.region}}.example.com/mcp',
        command: '',
        arguments: '',
        args: [],
        env: [],
        headers: [],
        credentialTemplate,
      },
      serverType,
      envVars: [],
      headerVars: [],
    }).config as ServerConfig;
    expect(normalizeServerConfigForPersistence(payload).credentialTemplate).toEqual(
      credentialTemplate,
    );
  },
);
