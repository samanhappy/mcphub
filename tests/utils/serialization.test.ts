import {
  createSafeJSON,
  formatErrorForLogging,
  safeStringify,
  summarizeErrorForLogging,
} from '../../src/utils/serialization.js';

describe('serialization utilities', () => {
  it('safeStringify redacts OAuth tokens and remote HTTP error details from logs', () => {
    const remoteError = Object.assign(new Error('access_token=super-secret'), {
      code: 'ERR_BAD_REQUEST',
      response: {
        status: 401,
        data: {
          access_token: 'super-secret',
          refresh_token: 'even-more-secret',
        },
        headers: {
          'x-request-id': 'req-123',
        },
      },
    });

    const result = safeStringify({
      accessToken: 'abc123',
      authorization: 'Bearer abc123',
      nested: {
        clientSecret: 'shhh',
      },
      error: remoteError,
    });

    expect(result).toContain('"accessToken":"[REDACTED]"');
    expect(result).toContain('"authorization":"[REDACTED]"');
    expect(result).toContain('"clientSecret":"[REDACTED]"');
    expect(result).toContain('"message":"[Remote request failed; response details omitted]"');
    expect(result).toContain('"status":401');
    expect(result).toContain('"requestId":"req-123"');
    expect(result).not.toContain('super-secret');
    expect(result).not.toContain('even-more-secret');
  });

  it('safeStringify preserves nested Error details instead of serializing them as empty objects', () => {
    const error = new Error('boom');
    (error as Error & { code?: string }).code = 'E_BANG';

    const result = safeStringify({
      scope: 'test',
      error,
    });

    expect(result).toContain('"scope":"test"');
    expect(result).toContain('"message":"boom"');
    expect(result).toContain('"name":"Error"');
    expect(result).toContain('"code":"E_BANG"');
    expect(result).toContain('"stack":');
    expect(result).not.toContain('"error":{}');
  });

  it('createSafeJSON preserves nested Error details while still handling circular references', () => {
    const error = new Error('circular boom');
    const payload: Record<string, unknown> = { error };
    payload.self = payload;

    const safePayload = createSafeJSON(payload) as {
      error: { name: string; message: string; stack: string };
      self: string;
    };

    expect(safePayload.error).toEqual(
      expect.objectContaining({
        name: 'Error',
        message: 'circular boom',
      }),
    );
    expect(typeof safePayload.error.stack).toBe('string');
    expect(safePayload.self).toBe('[Circular Reference]');
  });

  it('summarizeErrorForLogging and formatErrorForLogging omit remote response details', () => {
    const error = Object.assign(new Error('oauth response: {"access_token":"top-secret"}'), {
      code: 'ERR_BAD_REQUEST',
      response: {
        status: 401,
        data: {
          access_token: 'top-secret',
        },
        headers: {
          'x-request-id': 'req-456',
        },
      },
    });

    const summary = summarizeErrorForLogging(error);
    const formatted = formatErrorForLogging(error);

    expect(summary).toEqual(
      expect.objectContaining({
        message: '[Remote request failed; response details omitted]',
        status: 401,
        code: 'ERR_BAD_REQUEST',
        requestId: 'req-456',
      }),
    );
    expect(JSON.stringify(summary)).not.toContain('top-secret');
    expect(formatted).toContain('[Remote request failed; response details omitted]');
    expect(formatted).toContain('status=401');
    expect(formatted).not.toContain('top-secret');
  });
});
