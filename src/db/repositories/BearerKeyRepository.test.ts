const mockRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  update: jest.fn(),
  create: jest.fn((x) => x),
  save: jest.fn(async (x) => x),
};
jest.mock('../connection.js', () => ({
  getAppDataSource: () => ({ getRepository: () => mockRepo }),
}));

import { BearerKeyRepository } from './BearerKeyRepository.js';
import { hashBearerToken } from '../../utils/bearerKeyToken.js';

describe('BearerKeyRepository token hashing', () => {
  beforeEach(() => jest.clearAllMocks());

  it('persists hash and prefix, never the raw token', async () => {
    await new BearerKeyRepository().create({
      name: 'k',
      token: 'mcphub_secret',
      enabled: true,
      kind: 'system',
      accessType: 'all',
    } as any);
    const saved = mockRepo.save.mock.calls[0][0];
    expect(saved.token).toBeUndefined();
    expect(saved.tokenHash).toBe(hashBearerToken('mcphub_secret'));
    expect(saved.tokenPrefix).toBe('mcphub_s');
  });

  it('looks keys up by hash', async () => {
    await new BearerKeyRepository().findByToken('mcphub_secret');
    expect(mockRepo.findOne.mock.calls[0][0].where[0]).toEqual({
      tokenHash: hashBearerToken('mcphub_secret'),
    });
  });

  it('hashes only legacy rows and clears the raw column', async () => {
    mockRepo.find.mockResolvedValue([
      { id: 'a', token: 'old-raw-token', tokenHash: null },
      { id: 'b', token: null, tokenHash: 'x' },
    ]);
    expect(await new BearerKeyRepository().hashLegacyTokens()).toBe(1);
    expect(mockRepo.update).toHaveBeenCalledTimes(1);
    expect(mockRepo.update).toHaveBeenCalledWith(
      { id: 'a' },
      { tokenHash: hashBearerToken('old-raw-token'), tokenPrefix: 'old-raw-', token: null },
    );
  });

  it('accepts an already hashed key (JSON to DB migration of hashed keys)', async () => {
    await new BearerKeyRepository().create({
      name: 'k',
      tokenHash: 'h'.repeat(64),
      tokenPrefix: 'mcphub_a',
      enabled: true,
      kind: 'system',
      accessType: 'all',
    } as any);
    expect(mockRepo.save.mock.calls[0][0]).toMatchObject({
      tokenHash: 'h'.repeat(64),
      tokenPrefix: 'mcphub_a',
    });
  });
});
