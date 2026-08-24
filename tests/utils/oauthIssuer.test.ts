import {
  expectedIssValues,
  validateAuthorizationIss,
} from '../../src/utils/oauthIssuer.js';

describe('oauthIssuer (RFC 9207 iss validation)', () => {
  describe('expectedIssValues', () => {
    it('derives the origin from the authorization URL', () => {
      expect(
        expectedIssValues({
          authorizationUrl: 'https://as.example.com/authorize?client_id=x',
        }),
      ).toEqual(['https://as.example.com']);
    });

    it('includes the explicitly configured issuer', () => {
      expect(
        expectedIssValues({
          configuredIssuer: 'https://auth.example.com',
          authorizationUrl: 'https://auth.example.com/authorize',
        }),
      ).toEqual(['https://auth.example.com']);
    });

    it('deduplicates candidates', () => {
      expect(
        expectedIssValues({
          configuredIssuer: 'https://as.example.com',
          authorizationUrl: 'https://as.example.com/authorize',
        }),
      ).toEqual(['https://as.example.com']);
    });

    it('returns empty for no usable candidates', () => {
      expect(expectedIssValues({})).toEqual([]);
      expect(expectedIssValues({ authorizationUrl: 'not-a-url' })).toEqual([]);
    });
  });

  describe('validateAuthorizationIss', () => {
    it('passes without checking when iss is absent (legacy servers)', () => {
      const result = validateAuthorizationIss({
        authorizationUrl: 'https://as.example.com/authorize',
      });
      expect(result).toEqual({ valid: true, checked: false });
    });

    it('accepts an iss matching the authorization endpoint origin', () => {
      const result = validateAuthorizationIss({
        iss: 'https://as.example.com',
        authorizationUrl: 'https://as.example.com/authorize',
      });
      expect(result).toEqual({ valid: true, checked: true });
    });

    it('accepts an iss matching the explicitly configured issuer', () => {
      const result = validateAuthorizationIss({
        iss: 'https://tenant.auth.example.com',
        configuredIssuer: 'https://tenant.auth.example.com',
        authorizationUrl: 'https://other.example.com/authorize',
      });
      expect(result).toEqual({ valid: true, checked: true });
    });

    it('rejects a mismatched iss before the code is redeemed', () => {
      const result = validateAuthorizationIss({
        iss: 'https://evil.example.com',
        authorizationUrl: 'https://as.example.com/authorize',
        configuredIssuer: 'https://as.example.com',
      });
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.checked).toBe(true);
        expect(result.reason).toContain('iss');
      }
    });

    it('fails safe when iss is present but no expected issuer is known', () => {
      const result = validateAuthorizationIss({ iss: 'https://somewhere.example.com' });
      expect(result).toEqual({ valid: true, checked: false });
    });
  });
});
