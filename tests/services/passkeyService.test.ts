import type { Request } from 'express';
import {
  consumeChallengeToken,
  normalizePasskeyName,
  resolveRelyingParty,
  startPasskeyAuthentication,
} from '../../src/services/passkeyService.js';
import { resolveJwtUser, signDashboardToken } from '../../src/utils/userSession.js';

jest.mock('../../src/dao/index.js', () => ({
  getPasskeyDao: () => ({ findByUsername: async () => [] }),
  getUserDao: () => ({ findByUsername: async () => null }),
}));

const requestWith = (headers: Record<string, string>, protocol = 'http'): Request =>
  ({
    protocol,
    get: (name: string) => headers[name.toLowerCase()],
  }) as unknown as Request;

describe('passkeyService', () => {
  describe('resolveRelyingParty', () => {
    it('uses the browser origin, including a dev server port', () => {
      expect(
        resolveRelyingParty(
          requestWith({ origin: 'http://localhost:5173', host: 'localhost:3000' }),
        ),
      ).toEqual({ rpId: 'localhost', origin: 'http://localhost:5173' });
    });

    it('falls back to the forwarded protocol and host without an Origin header', () => {
      expect(resolveRelyingParty(requestWith({ host: 'hub.example.test' }, 'https'))).toEqual({
        rpId: 'hub.example.test',
        origin: 'https://hub.example.test',
      });
    });

    it('rejects opaque or non-web origins', () => {
      expect(resolveRelyingParty(requestWith({ origin: 'null' }))).toBeNull();
      expect(resolveRelyingParty(requestWith({ origin: 'file:///tmp/page.html' }))).toBeNull();
      expect(resolveRelyingParty(requestWith({}))).toBeNull();
    });
  });

  describe('normalizePasskeyName', () => {
    it('trims, strips control characters and caps the length', () => {
      expect(normalizePasskeyName('  Work\u0000 laptop\n ')).toBe('Work laptop');
      expect(normalizePasskeyName('é'.repeat(80))).toHaveLength(64);
      expect(normalizePasskeyName(42)).toBe('');
    });
  });

  describe('consumeChallengeToken', () => {
    const rp = { rpId: 'localhost', origin: 'http://localhost:3000' };

    it('keeps challenge tokens and dashboard session tokens apart', async () => {
      const { challengeToken } = await startPasskeyAuthentication(rp);
      expect(await resolveJwtUser(challengeToken)).toBeNull();
      const sessionToken = signDashboardToken({ username: 'alice', password: 'hash' });
      expect(await consumeChallengeToken(sessionToken, 'authentication')).toBeNull();
      expect(await consumeChallengeToken('not-a-token', 'registration')).toBeNull();
      expect(await consumeChallengeToken(undefined, 'registration')).toBeNull();
    });

    it('accepts a challenge once, and only for the ceremony it was issued for', async () => {
      const { options, challengeToken } = await startPasskeyAuthentication(rp);
      expect(await consumeChallengeToken(challengeToken, 'registration')).toBeNull();
      expect(await consumeChallengeToken(challengeToken, 'authentication')).toMatchObject({
        ...rp,
        challenge: options.challenge,
      });
      expect(await consumeChallengeToken(challengeToken, 'authentication')).toBeNull();
    });
  });
});
