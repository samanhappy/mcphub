import { readFileSync } from 'node:fs';

import {
  REDACTED_SIGNATURE_VALUE,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifyInternalSignature,
} from '../../src/services/hostedInternalAuth.js';
import {
  reserveHostedCredit,
  validateHostedApiKey,
} from '../../src/services/hostedControlPlaneClient.js';

describe('hostedControlPlaneClient signature redaction', () => {
  const originalFetch = global.fetch;
  const originalSecret = process.env.INTERNAL_API_SECRET;
  const originalControlPlaneUrl = process.env.HOSTED_CONTROL_PLANE_URL;

  it('does not let requestControlPlane fall back to signing a nullish-coalesced body', () => {
    const source = readFileSync(
      `${process.cwd()}/src/services/hostedControlPlaneClient.ts`,
      'utf8',
    );

    expect(source).not.toMatch(/signInternalRequest\s*\([^)]*\?\?[^)]*\)/s);
  });

  beforeEach(() => {
    process.env.INTERNAL_API_SECRET = '12345678901234567890123456789012';
    process.env.HOSTED_CONTROL_PLANE_URL = 'https://control-plane.example';
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;

    if (originalSecret === undefined) {
      delete process.env.INTERNAL_API_SECRET;
    } else {
      process.env.INTERNAL_API_SECRET = originalSecret;
    }

    if (originalControlPlaneUrl === undefined) {
      delete process.env.HOSTED_CONTROL_PLANE_URL;
    } else {
      process.env.HOSTED_CONTROL_PLANE_URL = originalControlPlaneUrl;
    }
  });

  function mockSuccessResponse(data: unknown): void {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({
        success: true,
        data,
      }),
    });
  }

  function getLatestRequest(): { url: string; headers: Headers; body: string } {
    const call = (global.fetch as jest.Mock).mock.calls.at(-1);
    if (!call) {
      throw new Error('Expected fetch to have been called');
    }

    const [url, init] = call as [string | URL, RequestInit | undefined];
    return {
      url: String(url),
      headers: new Headers(init?.headers),
      body: String(init?.body ?? ''),
    };
  }

  it('sends the raw API key while signing a redacted validate payload', async () => {
    mockSuccessResponse({
      valid: true,
      userId: 'user-1',
      apiKeyId: 'key-1',
      prefix: 'abcdefghijkl',
      scopeSlugs: null,
      contentRecordingEnabled: false,
      cacheTtlSeconds: 30,
    });

    await validateHostedApiKey('mcphub-sk-real-secret');

    const request = getLatestRequest();

    expect(request.url).toBe('https://control-plane.example/api/internal/v1/keys/validate');
    expect(request.body).toBe(JSON.stringify({ apiKey: 'mcphub-sk-real-secret' }));
    expect(
      verifyInternalSignature({
        method: 'POST',
        path: '/api/internal/v1/keys/validate',
        body: { apiKey: REDACTED_SIGNATURE_VALUE },
        timestamp: request.headers.get(TIMESTAMP_HEADER),
        signature: request.headers.get(SIGNATURE_HEADER),
      }),
    ).toEqual({ ok: true });
  });

  it('does not read apiKeyId when building the signed reserve payload', async () => {
    mockSuccessResponse({
      reservationId: 'reservation-1',
      estimatedCostMillicents: 123,
      balanceMillicents: 456,
    });

    let apiKeyIdReadCount = 0;
    const input = {
      userId: 'user-1',
      serverSlug: 'server-a',
      toolName: 'tool-a',
      hubRequestId: 'request-1',
    } as {
      userId: string;
      apiKeyId: string | null;
      serverSlug: string;
      toolName: string;
      hubRequestId: string;
    };

    Object.defineProperty(input, 'apiKeyId', {
      enumerable: true,
      get: () => {
        apiKeyIdReadCount += 1;
        return 'key-1';
      },
    });

    await reserveHostedCredit(input);

    const request = getLatestRequest();

    expect(request.url).toBe('https://control-plane.example/api/internal/v1/credits/reserve');
    expect(JSON.parse(request.body)).toEqual({
      userId: 'user-1',
      apiKeyId: 'key-1',
      serverSlug: 'server-a',
      toolName: 'tool-a',
      hubRequestId: 'request-1',
    });
    expect(apiKeyIdReadCount).toBe(1);
    expect(
      verifyInternalSignature({
        method: 'POST',
        path: '/api/internal/v1/credits/reserve',
        body: {
          userId: 'user-1',
          apiKeyId: REDACTED_SIGNATURE_VALUE,
          serverSlug: 'server-a',
          toolName: 'tool-a',
          hubRequestId: 'request-1',
        },
        timestamp: request.headers.get(TIMESTAMP_HEADER),
        signature: request.headers.get(SIGNATURE_HEADER),
      }),
    ).toEqual({ ok: true });
  });
});
