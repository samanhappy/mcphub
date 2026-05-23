import {
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

  it('verifies equivalent JSON bodies even when object key order differs', () => {
    const requestBody = {
      serverSlug: 'server-a',
      metadata: { z: 1, a: 2 },
      items: [{ b: 2, a: 1 }],
      apiKey: 'mcphub-sk-secret',
      apiKeyId: 'key-1',
    };

    const { timestamp, signature } = signInternalRequest(
      'POST',
      '/api/internal/v1/credits/reserve',
      requestBody,
    );

    const result = verifyInternalSignature({
      method: 'POST',
      path: '/api/internal/v1/credits/reserve',
      body: {
        apiKeyId: 'key-1',
        apiKey: 'mcphub-sk-secret',
        items: [{ a: 1, b: 2 }],
        metadata: { a: 2, z: 1 },
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
        apiKey: 'mcphub-sk-secret',
      },
    );

    const result = verifyInternalSignature({
      method: 'POST',
      path: '/api/internal/v1/credits/reserve',
      body: {
        serverSlug: 'server-b',
        metadata: { a: 1 },
        apiKey: 'mcphub-sk-secret',
      },
      timestamp,
      signature,
    });

    expect(result).toEqual({ ok: false, reason: 'bad_signature' });
  });
});
