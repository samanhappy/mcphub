import {
  createUpstreamRequestError,
  isUpstreamConnectionFailure,
} from '../../src/utils/upstreamError.js';
import { safeStringify } from '../../src/utils/serialization.js';

const config = {
  credentialTemplate: [{ target: 'headers' as const, name: 'Authorization' }],
  headers: { Authorization: 'opaque secret' },
};

test.each([401, 403, 429, 500])(
  'preserves HTTP %i diagnostics without blaming bindings',
  (status) => {
    const original = Object.assign(new Error('Upstream rejected opaque secret (opaque%20secret)'), {
      status,
      response: { data: { token: 'body-secret' }, headers: { 'x-request-id': 'req-42' } },
    });
    const failure = createUpstreamRequestError('github', 'connect', original, config);
    expect(failure.message).toContain('github');
    expect(failure.message).toContain('connect');
    expect(failure.message).toContain(`status=${status}`);
    expect(failure.message).toContain('req-42');
    expect(failure.message).toContain('Upstream rejected');
    expect(safeStringify(failure)).not.toMatch(/opaque|body-secret|Check your binding/);
    expect(failure).not.toHaveProperty('cause');
  },
);

test('bounds diagnostics after removing secrets and preserves network attribution', () => {
  const error = Object.assign(
    new Error('connect ETIMEDOUT example.com:443 ' + 'opaque secret'.repeat(1000)),
    { code: 'ETIMEDOUT' },
  );
  const failure = createUpstreamRequestError('github', 'callTool', error, config);
  expect(failure.message).toContain('example.com:443');
  expect(failure.message).toContain('ETIMEDOUT');
  expect(failure.message.length).toBeLessThan(2300);
  expect(failure.message).not.toContain('opaque');
});

test('only known connection failures invalidate a runtime', () => {
  expect(isUpstreamConnectionFailure({ code: 'ECONNRESET' })).toBe(true);
  expect(isUpstreamConnectionFailure({ code: 'EPIPE' })).toBe(true);
  expect(isUpstreamConnectionFailure({ code: -32602 })).toBe(false);
  expect(isUpstreamConnectionFailure({ status: 400 })).toBe(false);
  expect(isUpstreamConnectionFailure({ code: 'ETIMEDOUT' })).toBe(false);
});

test('redacts opaque authorization values even when the scheme is omitted by the upstream', () => {
  const failure = createUpstreamRequestError(
    'github',
    'callTool',
    new Error('Rejected opaque-auth-value'),
    {
      credentialTemplate: [{ target: 'headers', name: 'Authorization' }],
      headers: { Authorization: 'Bearer opaque-auth-value' },
    },
  );
  expect(failure.message).toContain('Rejected');
  expect(failure.message).not.toContain('opaque-auth-value');
});
