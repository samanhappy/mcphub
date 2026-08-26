import { OpenAPIClient } from '../openapi.js';
import type { ServerConfig, OpenAPIDeclaredSecurity } from '../../types/index.js';
import { OpenAPIV3 } from 'openapi-types';

// getDeclaredSecurity() needs no DAO (only initialize()'s admin check does),
// but mock the DAO like the sibling spec-auth suite so the client never
// touches real storage.
jest.mock('../../dao/index.js', () => {
  const findByUsername = jest.fn();
  return { getUserDao: () => ({ findByUsername }) };
});

const buildConfig = (schema: OpenAPIV3.Document): ServerConfig => ({
  type: 'openapi',
  openapi: { schema },
});

const baseSchema = (): OpenAPIV3.Document => ({
  openapi: '3.0.0',
  info: { title: 'Prefill API', version: '1.0.0' },
  paths: {
    '/things': {
      get: {
        operationId: 'get_things',
        responses: { '200': { description: 'ok' } },
      },
    },
  },
});

async function resolveSecurity(schema: OpenAPIV3.Document): Promise<OpenAPIDeclaredSecurity> {
  const client = new OpenAPIClient(buildConfig(schema));
  await client.initialize();
  return client.getDeclaredSecurity();
}

const noSecurity = (): OpenAPIDeclaredSecurity => ({
  declared: false,
  supported: false,
  summary: '',
  alternatives: 0,
  requiresCredentials: false,
});

describe('OpenAPIClient.getDeclaredSecurity (#1077)', () => {
  it('returns no requirement for a spec without security', async () => {
    await expect(resolveSecurity(baseSchema())).resolves.toEqual(noSecurity());
  });

  it('maps a root-level HTTP bearer scheme (with bearerFormat) to a prefill', async () => {
    const schema = baseSchema();
    schema.security = [{ 'Bearer Auth': [] }];
    schema.components = {
      securitySchemes: {
        'Bearer Auth': { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    };

    const result = await resolveSecurity(schema);

    expect(result.declared).toBe(true);
    expect(result.supported).toBe(true);
    expect(result.requiresCredentials).toBe(true);
    expect(result.alternatives).toBe(1);
    expect(result.summary).toBe('HTTP bearer (JWT)');
    expect(result.prefill).toEqual({
      type: 'http',
      http: { scheme: 'bearer', bearerFormat: 'JWT' },
    });
    expect(result.cookieHint).toBeUndefined();
  });

  it('maps HTTP basic to a prefill', async () => {
    const schema = baseSchema();
    schema.security = [{ basic: [] }];
    schema.components = { securitySchemes: { basic: { type: 'http', scheme: 'basic' } } };

    const result = await resolveSecurity(schema);

    expect(result.summary).toBe('HTTP basic');
    expect(result.prefill).toEqual({ type: 'http', http: { scheme: 'basic' } });
  });

  it('maps an apiKey header scheme including its name and location', async () => {
    const schema = baseSchema();
    schema.security = [{ 'ApiKey Auth': [] }];
    schema.components = {
      securitySchemes: { 'ApiKey Auth': { type: 'apiKey', in: 'header', name: 'X-API-Key' } },
    };

    const result = await resolveSecurity(schema);

    expect(result.summary).toBe("API key in header 'X-API-Key'");
    expect(result.prefill).toEqual({
      type: 'apiKey',
      apiKey: { name: 'X-API-Key', in: 'header' },
    });
    expect(result.cookieHint).toBeFalsy();
  });

  it('flags an apiKey cookie scheme as a cookieSession hint', async () => {
    const schema = baseSchema();
    schema.security = [{ session: [] }];
    schema.components = {
      securitySchemes: { session: { type: 'apiKey', in: 'cookie', name: 'session' } },
    };

    const result = await resolveSecurity(schema);

    expect(result.cookieHint).toBe(true);
    expect(result.prefill).toEqual({ type: 'apiKey', apiKey: { name: 'session', in: 'cookie' } });
  });

  it('lets an operation-level requirement override the root one', async () => {
    const schema = baseSchema();
    schema.security = [{ 'Root Bearer': [] }];
    schema.components = {
      securitySchemes: {
        'Root Bearer': { type: 'http', scheme: 'bearer' },
        'Op Key': { type: 'apiKey', in: 'query', name: 'api_key' },
      },
    };
    (schema.paths!['/things'].get as OpenAPIV3.OperationObject).security = [{ 'Op Key': [] }];

    const result = await resolveSecurity(schema);

    expect(result.prefill).toEqual({
      type: 'apiKey',
      apiKey: { name: 'api_key', in: 'query' },
    });
  });

  it('falls back to an operation requirement when the root declares no auth', async () => {
    const schema = baseSchema();
    schema.security = [];
    schema.components = {
      securitySchemes: { basic: { type: 'http', scheme: 'basic' } },
    };
    (schema.paths!['/things'].get as OpenAPIV3.OperationObject).security = [{ basic: [] }];

    const result = await resolveSecurity(schema);

    expect(result.prefill).toEqual({ type: 'http', http: { scheme: 'basic' } });
  });

  it('reports the OR-alternative count and picks the first mappable scheme', async () => {
    const schema = baseSchema();
    schema.security = [{ 'Key A': [] }, { 'Key B': [] }];
    schema.components = {
      securitySchemes: {
        'Key A': { type: 'apiKey', in: 'header', name: 'X-A' },
        'Key B': { type: 'apiKey', in: 'header', name: 'X-B' },
      },
    };

    const result = await resolveSecurity(schema);

    expect(result.alternatives).toBe(2);
    expect(result.prefill).toEqual({ type: 'apiKey', apiKey: { name: 'X-A', in: 'header' } });
  });

  it('maps an oauth2 clientCredentials tokenUrl when the flow declares one', async () => {
    const schema = baseSchema();
    schema.security = [{ oauth: [] }];
    schema.components = {
      securitySchemes: {
        oauth: {
          type: 'oauth2',
          flows: {
            clientCredentials: { tokenUrl: 'https://auth.example.com/token', scopes: {} },
          },
        },
      },
    };

    const result = await resolveSecurity(schema);

    expect(result.summary).toBe('OAuth2');
    expect(result.prefill).toEqual({
      type: 'oauth2',
      oauth2: { tokenUrl: 'https://auth.example.com/token' },
    });
  });

  it('maps an openIdConnect scheme to its discovery URL', async () => {
    const schema = baseSchema();
    schema.security = [{ oidc: [] }];
    schema.components = {
      securitySchemes: {
        oidc: { type: 'openIdConnect', openIdConnectUrl: 'https://issuer/.well-known/openid-configuration' },
      },
    };

    const result = await resolveSecurity(schema);

    expect(result.summary).toBe('OpenID Connect');
    expect(result.prefill).toEqual({
      type: 'openIdConnect',
      openIdConnect: { url: 'https://issuer/.well-known/openid-configuration' },
    });
  });

  it('reports http/digest as declared but unsupported', async () => {
    const schema = baseSchema();
    schema.security = [{ dig: [] }];
    schema.components = {
      securitySchemes: { dig: { type: 'http', scheme: 'digest' } },
    };

    const result = await resolveSecurity(schema);

    expect(result.declared).toBe(true);
    expect(result.supported).toBe(false);
    expect(result.requiresCredentials).toBe(false);
    expect(result.summary).toBe('HTTP digest');
    expect(result.unsupportedReason).toContain('digest');
  });

  it('reports unknown scheme types as declared but unsupported', async () => {
    const schema = baseSchema();
    schema.security = [{ mtls: [] }];
    schema.components = {
      securitySchemes: { mtls: { type: 'mutualTLS' } as unknown as OpenAPIV3.SecuritySchemeObject },
    };

    const result = await resolveSecurity(schema);

    expect(result.declared).toBe(true);
    expect(result.supported).toBe(false);
    expect(result.unsupportedReason).toContain('mutualTLS');
  });

  it('reports a requirement naming an undefined scheme as unrecognized', async () => {
    const schema = baseSchema();
    schema.security = [{ Ghost: [] }];

    const result = await resolveSecurity(schema);

    expect(result.declared).toBe(true);
    expect(result.supported).toBe(false);
    expect(result.summary).toBe('unknown security scheme');
  });
});
