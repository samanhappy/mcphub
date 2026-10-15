import { getBearerTokenFromHeaders } from '../../src/utils/bearerAuth.js';

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
