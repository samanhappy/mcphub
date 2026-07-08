import {
  createSafeJSON,
  formatErrorForLogging,
  safeStringify,
  sanitizeStringForLogging,
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

  it('formatErrorForLogging includes numeric transport error codes', () => {
    const error = Object.assign(
      new Error('Streamable HTTP error: Error POSTing to endpoint: '),
      { code: 502 },
    );

    const summary = summarizeErrorForLogging(error);
    const formatted = formatErrorForLogging(error);

    expect(summary).toEqual(
      expect.objectContaining({
        message: 'Streamable HTTP error: Error POSTing to endpoint: ',
        code: 502,
      }),
    );
    expect(formatted).toContain('Streamable HTTP error: Error POSTing to endpoint:');
    expect(formatted).toContain('code=502');
  });

  it('summarizeErrorForLogging redacts secrets from ordinary Error fields', () => {
    const error = Object.assign(new Error('oauth access_token=top-secret'), {
      code: 'E_OAUTH',
      accessToken: 'also-secret',
    });

    const summary = summarizeErrorForLogging(error);
    const formatted = formatErrorForLogging(error);

    expect(summary).toEqual(
      expect.objectContaining({
        message: 'oauth access_token=[REDACTED]',
        code: 'E_OAUTH',
      }),
    );
    expect(summary).not.toHaveProperty('accessToken');
    expect(JSON.stringify(summary)).not.toContain('top-secret');
    expect(JSON.stringify(summary)).not.toContain('also-secret');
    expect(formatted).not.toContain('top-secret');
  });

  it('redacts OAuth error response fields that may carry tokens', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
    const rawJson = `{"error":"invalid_token","error_description":"expired ${jwt}","error_uri":"https://auth.example.com/debug?token=${jwt}","error_code":"${jwt}","codeVerifier":"pkce-secret"}`;
    const rawText = `error_description=expired-${jwt}; error_uri=https://auth.example.com/debug?token=${jwt}; error_code=${jwt}; code_verifier=pkce-secret`;

    expect(sanitizeStringForLogging(rawJson)).toBe(
      '{"error":"invalid_token","error_description":"[REDACTED]","error_uri":"[REDACTED]","error_code":"[REDACTED]","codeVerifier":"[REDACTED]"}',
    );
    expect(sanitizeStringForLogging(rawText)).toBe(
      'error_description=[REDACTED]; error_uri=[REDACTED]; error_code=[REDACTED]; code_verifier=[REDACTED]',
    );
    expect(safeStringify({ error_description: `expired ${jwt}` })).toBe(
      '{"error_description":"[REDACTED]"}',
    );
    expect(safeStringify({ codeVerifier: 'pkce-secret' })).toBe(
      '{"codeVerifier":"[REDACTED]"}',
    );
  });

  it('createSafeJSON keeps shared (diamond) references instead of dropping them as circular', () => {
    const shared = { id: 1, label: 'shared' };
    const result = createSafeJSON({ a: shared, b: shared, list: [shared, shared] }) as {
      a: typeof shared;
      b: typeof shared;
      list: Array<typeof shared>;
    };

    // None of these are true cycles, so every occurrence must survive verbatim.
    expect(result.a).toEqual(shared);
    expect(result.b).toEqual(shared);
    expect(result.list[0]).toEqual(shared);
    expect(result.list[1]).toEqual(shared);
    expect(JSON.stringify(result)).not.toContain('[Circular Reference]');
  });

  it('safeStringify keeps shared references but still breaks true cycles', () => {
    const shared = { id: 7 };
    const cyclic: Record<string, unknown> = { shared, sibling: shared };
    cyclic.self = cyclic;

    const result = safeStringify(cyclic);
    const parsed = JSON.parse(result);

    expect(parsed.shared).toEqual({ id: 7 });
    expect(parsed.sibling).toEqual({ id: 7 });
    expect(parsed.self).toBe('[Circular Reference]');
    // Only the genuine self-reference should be flagged, not the shared sibling.
    expect(result.match(/\[Circular Reference\]/g)).toHaveLength(1);
  });

  it('createSafeJSON breaks deep transitive cycles', () => {
    const a: Record<string, unknown> = { name: 'a' };
    const b: Record<string, unknown> = { name: 'b' };
    a.child = b;
    b.parent = a; // a -> b -> a

    const result = createSafeJSON(a) as { name: string; child: { name: string; parent: string } };

    expect(result.name).toBe('a');
    expect(result.child.name).toBe('b');
    expect(result.child.parent).toBe('[Circular Reference]');
  });

  it('safeStringify still honors toJSON (e.g. Date) after the replacer change', () => {
    const when = new Date('2026-01-02T03:04:05.000Z');
    const result = safeStringify({ when });

    expect(result).toContain('2026-01-02T03:04:05.000Z');
  });

  it('createSafeJSON breaks cycles that close through a serialized Error', () => {
    const parent: Record<string, unknown> = { tag: 'PARENT' };
    const error = new Error('boom') as Error & { ctx?: unknown };
    error.ctx = parent; // error points back to its own ancestor
    parent.error = error;

    // Must not throw "Converting circular structure to JSON".
    const result = createSafeJSON(parent) as {
      tag: string;
      error: { message: string; ctx: string };
    };

    expect(result.tag).toBe('PARENT');
    expect(result.error.message).toBe('boom');
    expect(result.error.ctx).toBe('[Circular Reference]');
    // The ancestor must not be duplicated by a premature stack unwind.
    expect(JSON.stringify(result).match(/PARENT/g)).toHaveLength(1);
  });

  it('safeStringify terminates on a cyclic Error.cause chain', () => {
    const first = new Error('first') as Error & { cause?: unknown };
    const second = new Error('second') as Error & { cause?: unknown };
    first.cause = second;
    second.cause = first;

    // Must not blow the stack.
    const result = safeStringify({ first });
    const parsed = JSON.parse(result);

    expect(parsed.first.message).toBe('first');
    expect(parsed.first.cause.message).toBe('second');
    expect(parsed.first.cause.cause).toBe('[Circular Reference]');
  });
});
