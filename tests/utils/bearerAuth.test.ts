import {
  getBearerTokenFromHeaders,
  getForwardAuthTokenFromHeaders,
  resolveForwardAuthTokenHeaderName,
} from '../../src/utils/bearerAuth.js';

describe('getBearerTokenFromHeaders', () => {
  it('extracts the token from a Bearer header', () => {
    expect(getBearerTokenFromHeaders({ authorization: 'Bearer abc123' })).toBe('abc123');
  });

  // RFC 7235 section 2.1: the auth-scheme is case-insensitive.
  it.each(['bearer abc123', 'BEARER abc123', 'bEaReR abc123'])(
    'accepts a case-insensitive scheme: %s',
    (value) => {
      expect(getBearerTokenFromHeaders({ authorization: value })).toBe('abc123');
    },
  );

  it.each(['Bearer', 'Bearer ', 'Bearerabc123', 'Basic abc123', ''])(
    'returns null for %j',
    (value) => {
      expect(getBearerTokenFromHeaders({ authorization: value })).toBeNull();
    },
  );
});

describe('getForwardAuthTokenFromHeaders', () => {
  const withTokenHeader = (tokenHeader: string) => ({
    auth: { forwardAuth: { jwks: { tokenHeader } } },
  });

  afterEach(() => {
    delete process.env.FORWARD_AUTH_TOKEN_HEADER;
  });

  it('reads the bearer header when no token header is configured', () => {
    expect(getForwardAuthTokenFromHeaders({ authorization: 'Bearer a.b.c' })).toBe('a.b.c');
  });

  it.each(['a.b.c', 'Bearer a.b.c', ' a.b.c '])(
    'reads a configured token header sent as %j',
    (value) => {
      expect(
        getForwardAuthTokenFromHeaders(
          { 'cf-access-jwt-assertion': value },
          withTokenHeader('Cf-Access-Jwt-Assertion'),
        ),
      ).toBe('a.b.c');
    },
  );

  it('ignores the bearer header once a token header is configured', () => {
    expect(
      getForwardAuthTokenFromHeaders(
        { authorization: 'Bearer a.b.c' },
        withTokenHeader('Cf-Access-Jwt-Assertion'),
      ),
    ).toBeNull();
  });

  it('lets FORWARD_AUTH_TOKEN_HEADER override settings', () => {
    process.env.FORWARD_AUTH_TOKEN_HEADER = 'X-Env-Jwt';
    expect(resolveForwardAuthTokenHeaderName(withTokenHeader('X-Settings-Jwt'))).toBe('X-Env-Jwt');
    expect(
      getForwardAuthTokenFromHeaders({ 'x-env-jwt': 'a.b.c' }, withTokenHeader('X-Settings-Jwt')),
    ).toBe('a.b.c');
  });
});
