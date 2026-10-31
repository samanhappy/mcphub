import jwt from 'jsonwebtoken';
import type { IUser } from '../../src/types/index.js';
import { JWT_SECRET } from '../../src/config/jwt.js';
import { getUserSessionVersion, resolveJwtUser } from '../../src/utils/userSession.js';
import { resolveOAuthUserFromToken } from '../../src/utils/oauthBearer.js';
import { DataService } from '../../src/services/dataService.js';
import { authorizationService } from '../../src/services/authorizationService.js';
import { UserContextService } from '../../src/services/userContextService.js';

let mockUser: IUser;
let mockOAuthToken: Record<string, unknown>;
jest.mock('../../src/dao/index.js', () => ({
  getUserDao: () => ({ findByUsername: async () => mockUser }),
}));
jest.mock('../../src/services/oauthServerService.js', () => ({ isOAuthServerEnabled: () => true }));
jest.mock('../../src/models/OAuth.js', () => ({ getToken: async () => mockOAuthToken }));

beforeEach(() => {
  mockUser = { username: 'alice', password: 'stored-hash', userGroups: ['readers'] };
  mockOAuthToken = {
    username: 'alice',
    accessToken: 'oauth-token',
    sessionVersion: getUserSessionVersion(mockUser),
  };
});

it.each(['dashboard', 'oauth'])(
  'uses live memberships and revokes existing %s credentials without changing them',
  async (method) => {
    const token = jwt.sign(
      {
        user: {
          username: mockUser.username,
          sessionVersion: getUserSessionVersion(mockUser),
          userGroups: ['readers', 'writers'],
        },
      },
      JWT_SECRET,
    );
    const resolve = () =>
      method === 'oauth' ? resolveOAuthUserFromToken('oauth-token') : resolveJwtUser(token);
    const server = {
      owner: 'admin',
      visibility: 'group' as const,
      sharedWithUserGroups: ['readers'],
    };
    const principal = await resolve();
    expect(principal?.userGroups).toEqual(['readers']);
    expect(authorizationService.can('server.invoke', server, principal)).toBe(true);
    expect(authorizationService.can('server.manage', server, principal)).toBe(false);
    mockUser = { ...mockUser, userGroups: [] };
    const revoked = await resolve();
    expect(revoked).not.toBeNull();
    expect(authorizationService.can('server.invoke', server, revoked)).toBe(false);
    UserContextService.getInstance().runWithContext(() => {
      expect(new DataService().filterData([server])).toEqual([]);
    }, revoked);
  },
);
