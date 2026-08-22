import { resolveCorsOrigin } from './corsOrigin.js';

describe('resolveCorsOrigin', () => {
  it('denies requests without an Origin header', () => {
    expect(resolveCorsOrigin(undefined, 'mcphub.local:3000', undefined)).toBe(false);
  });

  it('reflects origins listed in ALLOWED_ORIGINS', () => {
    const env = 'https://app.example.com, https://admin.example.com';
    expect(resolveCorsOrigin('https://admin.example.com', 'other.host', env)).toBe(
      'https://admin.example.com',
    );
    expect(resolveCorsOrigin('https://evil.example.net', 'other.host', env)).toBe(false);
  });

  it('allows same-host origins without explicit configuration', () => {
    expect(resolveCorsOrigin('http://localhost:3000', 'localhost:3000', undefined)).toBe(
      'http://localhost:3000',
    );
  });

  it('rejects cross-host origins without configuration', () => {
    expect(resolveCorsOrigin('http://evil.example.net', 'mcphub.local:3000', undefined)).toBe(
      false,
    );
  });

  it('handles malformed origins safely', () => {
    expect(resolveCorsOrigin('not-a-url', 'localhost:3000', undefined)).toBe(false);
  });
});
