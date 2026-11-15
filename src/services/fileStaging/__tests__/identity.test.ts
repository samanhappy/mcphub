import { resolveStagingPrincipal } from '../identity.js';

const mockFindByUsername = jest.fn();
const mockUpdate = jest.fn();

jest.mock('../../../dao/DaoFactory.js', () => ({
  getUserDao: () => ({ findByUsername: mockFindByUsername, update: mockUpdate }),
}));

describe('staging principal identity', () => {
  beforeEach(() => {
    mockFindByUsername.mockReset();
    mockUpdate.mockReset();
  });

  it('rejects reserved and unknown principals', async () => {
    for (const name of ['system', 'api-session', 'openapi-session', 'guest', 'anonymous', '']) {
      await expect(resolveStagingPrincipal(name)).rejects.toMatchObject({
        code: 'unauthenticated',
      });
    }
    mockFindByUsername.mockResolvedValue(null);
    await expect(resolveStagingPrincipal('alice')).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('hashes a stable user id, never the username', async () => {
    mockFindByUsername.mockResolvedValue({ username: 'alice', password: 'x', id: 'user-uuid' });
    const first = await resolveStagingPrincipal('alice');
    const second = await resolveStagingPrincipal('alice');
    expect(first.ownerHash).toBe(second.ownerHash);
    expect(first.ownerHash).not.toContain('alice');
    expect(first.ownerHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('persists a salt once for file-mode users and keeps the hash stable', async () => {
    mockFindByUsername.mockResolvedValue({ username: 'bob', password: 'x' });
    mockUpdate.mockImplementation(async (_name: string, updates: { stagingSalt?: string }) => ({
      username: 'bob',
      password: 'x',
      ...updates,
    }));
    const first = await resolveStagingPrincipal('bob');
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const salt = mockUpdate.mock.calls[0][1].stagingSalt;
    expect(salt).toMatch(/^[a-f0-9]{64}$/);

    mockFindByUsername.mockResolvedValue({ username: 'bob', password: 'x', stagingSalt: salt });
    const second = await resolveStagingPrincipal('bob');
    expect(second.ownerHash).toBe(first.ownerHash);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it('gives two concurrent first requests the same identity and one salt', async () => {
    let stored: { stagingSalt?: string } | undefined;
    mockFindByUsername.mockImplementation(async () => ({ username: 'carol', password: 'x', ...stored }));
    mockUpdate.mockImplementation(async (_name: string, updates: { stagingSalt?: string }) => {
      // A real DAO round-trip is slow enough for a second request to interleave.
      await new Promise((resolve) => setTimeout(resolve, 20));
      stored = { ...stored, ...updates };
      return { username: 'carol', password: 'x', ...stored };
    });

    const [first, second] = await Promise.all([
      resolveStagingPrincipal('carol'),
      resolveStagingPrincipal('carol'),
    ]);
    expect(first.ownerHash).toBe(second.ownerHash);
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });
});
