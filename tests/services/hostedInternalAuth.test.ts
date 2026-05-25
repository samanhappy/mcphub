import {
  REDACTED_SIGNATURE_VALUE,
  serializeInternalRequestBodyForSignature,
  signInternalRequest,
  verifyInternalSignature,
} from '../../src/services/hostedInternalAuth.js';

describe('hostedInternalAuth signature normalization', () => {
  const originalSecret = process.env.INTERNAL_API_SECRET;

  beforeEach(() => {
    process.env.INTERNAL_API_SECRET = '12345678901234567890123456789012';
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.INTERNAL_API_SECRET;
      return;
    }

    process.env.INTERNAL_API_SECRET = originalSecret;
  });

  it('normalizes equivalent JSON bodies even when object key order differs', () => {
    const firstBody = {
      serverSlug: 'server-a',
      metadata: { z: 1, a: 2 },
      items: [{ b: 2, a: 1 }],
      apiKey: 'mcphub-sk-secret',
      apiKeyId: 'key-1',
    };
    const secondBody = {
      apiKeyId: 'key-1',
      apiKey: 'mcphub-sk-secret',
      items: [{ a: 1, b: 2 }],
      metadata: { a: 2, z: 1 },
      serverSlug: 'server-a',
    };

    expect(serializeInternalRequestBodyForSignature(firstBody)).toBe(
      serializeInternalRequestBodyForSignature(secondBody),
    );
  });

  it('does not read sensitive credential values while canonicalizing signature bodies', () => {
    const createSensitiveBody = (): Record<string, unknown> => {
      const body: Record<string, unknown> = {
        serverSlug: 'server-a',
        metadata: { z: 1, a: 2 },
      };

      Object.defineProperty(body, 'apiKey', {
        enumerable: true,
        get: () => {
          throw new Error('apiKey should not be read during signature normalization');
        },
      });

      Object.defineProperty(body, 'apiKeyId', {
        enumerable: true,
        get: () => {
          throw new Error('apiKeyId should not be read during signature normalization');
        },
      });

      return body;
    };

    expect(serializeInternalRequestBodyForSignature(createSensitiveBody())).toBe(
      JSON.stringify({
        apiKey: REDACTED_SIGNATURE_VALUE,
        apiKeyId: REDACTED_SIGNATURE_VALUE,
        metadata: { a: 2, z: 1 },
        serverSlug: 'server-a',
      }),
    );
  });

  it('verifies redacted signature bodies without hashing sensitive credential values', () => {
    const { timestamp, signature } = signInternalRequest(
      'POST',
      '/api/internal/v1/credits/reserve',
      {
        apiKeyId: REDACTED_SIGNATURE_VALUE,
        apiKey: REDACTED_SIGNATURE_VALUE,
        items: [{ a: 1, b: 2 }],
        metadata: { a: 2, z: 1 },
        serverSlug: 'server-a',
      },
    );

    const result = verifyInternalSignature({
      method: 'POST',
      path: '/api/internal/v1/credits/reserve',
      body: {
        apiKey: REDACTED_SIGNATURE_VALUE,
        apiKeyId: REDACTED_SIGNATURE_VALUE,
        metadata: { z: 1, a: 2 },
        items: [{ b: 2, a: 1 }],
        serverSlug: 'server-a',
      },
      timestamp,
      signature,
    });

    expect(result).toEqual({ ok: true });
  });

  it('rejects signatures when non-sensitive body fields change', () => {
    const { timestamp, signature } = signInternalRequest(
      'POST',
      '/api/internal/v1/credits/reserve',
      {
        serverSlug: 'server-a',
        metadata: { a: 1 },
        apiKey: REDACTED_SIGNATURE_VALUE,
      },
    );

    const result = verifyInternalSignature({
      method: 'POST',
      path: '/api/internal/v1/credits/reserve',
      body: {
        serverSlug: 'server-b',
        metadata: { a: 1 },
        apiKey: REDACTED_SIGNATURE_VALUE,
      },
      timestamp,
      signature,
    });

    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });
});
