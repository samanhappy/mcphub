import { AuthorizationService } from '../../src/services/authorizationService.js';
import { UserContextService } from '../../src/services/userContextService.js';

jest.mock('../../src/services/userContextService.js', () => ({
  UserContextService: {
    getInstance: jest.fn(() => ({
      getCurrentUser: mockGetCurrentUser,
    })),
  },
}));

const mockGetCurrentUser = jest.fn();

const admin = { username: 'admin', isAdmin: true };
const bob = { username: 'bob', isAdmin: false };
const alice = { username: 'alice', isAdmin: false };

describe('AuthorizationService (#1036 Phase 1)', () => {
  let service: AuthorizationService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentUser.mockReturnValue(null);
    service = new AuthorizationService();
  });

  describe('server.config.read', () => {
    const server = { owner: 'bob', visibility: 'public' as const };

    it('allows admins', () => {
      expect(service.can('server.config.read', server, admin)).toBe(true);
    });

    it('allows the owner', () => {
      expect(service.can('server.config.read', server, bob)).toBe(true);
    });

    it('denies a shared regular user even on a public server', () => {
      expect(service.can('server.config.read', server, alice)).toBe(false);
    });

    it('denies an unrelated user', () => {
      expect(service.can('server.config.read', server, alice)).toBe(false);
    });

    it('denies anonymous callers', () => {
      expect(service.can('server.config.read', server, null)).toBe(false);
    });
  });

  describe('server.manage', () => {
    it('mirrors config.read semantics (owner allow, shared user deny)', () => {
      const server = { owner: 'bob', visibility: 'group' as const, sharedWithUsers: ['alice'] };
      expect(service.can('server.manage', server, bob)).toBe(true);
      expect(service.can('server.manage', server, alice)).toBe(false);
      expect(service.can('server.manage', server, admin)).toBe(true);
    });

    it('normalizes a missing/blank owner to the admin account', () => {
      const orphan = { owner: '  ', visibility: 'private' as const };
      expect(service.can('server.manage', orphan, admin)).toBe(true);
      expect(service.can('server.manage', orphan, bob)).toBe(false);
      const legacy = { visibility: 'private' as const };
      expect(service.can('server.manage', legacy, admin)).toBe(true);
    });
  });

  describe('server.discover / server.invoke', () => {
    it('follows filterData visibility semantics for public servers', () => {
      const server = { owner: 'bob', visibility: 'public' as const };
      expect(service.can('server.discover', server, alice)).toBe(true);
      expect(service.can('server.invoke', server, alice)).toBe(true);
    });

    it('admits explicitly shared group members and rejects unshared ones', () => {
      const server = {
        owner: 'bob',
        visibility: 'group' as const,
        sharedWithUsers: ['alice'],
      };
      expect(service.can('server.invoke', server, alice)).toBe(true);

      const unshared = { ...server, sharedWithUsers: ['charlie'] };
      expect(service.can('server.invoke', unshared, alice)).toBe(false);
    });

    it('treats rows without visibility as private (fail closed)', () => {
      const legacy = { owner: 'bob' };
      expect(service.can('server.invoke', legacy, alice)).toBe(false);
      expect(service.can('server.invoke', legacy, bob)).toBe(true);
    });

    it('denies anonymous callers even for public servers', () => {
      const server = { owner: 'bob', visibility: 'public' as const };
      expect(service.can('server.invoke', server, null)).toBe(false);
    });
  });

  describe('principal resolution', () => {
    it('falls back to the ambient user context when no principal is passed', () => {
      mockGetCurrentUser.mockReturnValue(bob);
      expect(
        service.can('server.config.read', { owner: undefined, visibility: 'private' }),
      ).toBe(false);
      mockGetCurrentUser.mockReturnValue(admin);
      expect(
        service.can('server.config.read', { owner: undefined, visibility: 'private' }),
      ).toBe(true);
    });

    it('prefers an explicit principal over the ambient context', () => {
      mockGetCurrentUser.mockReturnValue(admin);
      expect(
        service.can('server.config.read', { owner: 'bob', visibility: 'public' }, alice),
      ).toBe(false);
    });
  });
});
