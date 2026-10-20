const mockRepository = {
  create: jest.fn(),
  findByAccessToken: jest.fn(),
};

jest.mock('../../src/db/repositories/OAuthTokenRepository.js', () => ({
  OAuthTokenRepository: jest.fn(() => mockRepository),
}));

import { OAuthTokenDaoDbImpl } from '../../src/dao/OAuthTokenDaoDbImpl.js';

it('preserves the credential version through database token writes and reads', async () => {
  const token = {
    accessToken: 'access',
    accessTokenExpiresAt: new Date(Date.now() + 3600000),
    refreshToken: 'refresh',
    refreshTokenExpiresAt: new Date(Date.now() + 86400000),
    clientId: 'client',
    username: 'alice',
    sessionVersion: 'a'.repeat(64),
  };
  mockRepository.create.mockResolvedValue(token);
  mockRepository.findByAccessToken.mockResolvedValue(token);
  const dao = new OAuthTokenDaoDbImpl();
  expect(await dao.create(token)).toEqual(token);
  expect(mockRepository.create).toHaveBeenCalledWith(
    expect.objectContaining({
      sessionVersion: token.sessionVersion,
    }),
  );
  expect(await dao.findByAccessToken(token.accessToken)).toEqual(token);
});
