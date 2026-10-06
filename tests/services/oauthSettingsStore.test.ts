jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(),
}));

import { getServerDao } from '../../src/dao/index.js';
import { persistClientCredentials } from '../../src/services/oauthSettingsStore.js';

describe('persistClientCredentials: explicitly-empty vs unset scopes (#1227)', () => {
  const findById = jest.fn();
  const update = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (getServerDao as jest.Mock).mockReturnValue({ findById, update });
    findById.mockResolvedValue({ name: 'pcloud', url: 'https://mcp.pcloud.com/mcp' });
    update.mockImplementation(async (_name: string, patch: Record<string, unknown>) => ({
      name: 'pcloud',
      url: 'https://mcp.pcloud.com/mcp',
      ...patch,
    }));
  });

  it('persists an explicitly empty scopes array instead of dropping it', async () => {
    const result = await persistClientCredentials('pcloud', {
      clientId: 'client-id',
      scopes: [],
    });

    expect(update).toHaveBeenCalledWith(
      'pcloud',
      expect.objectContaining({ oauth: expect.objectContaining({ scopes: [] }) }),
      { runtimeOAuth: true },
    );
    expect(result?.oauth.scopes).toEqual([]);
  });

  it('leaves scopes untouched when none were resolved', async () => {
    await persistClientCredentials('pcloud', {
      clientId: 'client-id',
    });

    const patch = update.mock.calls[0][1];
    expect(patch.oauth).not.toHaveProperty('scopes');
  });

  it('persists a non-empty scopes array as before', async () => {
    const result = await persistClientCredentials('pcloud', {
      clientId: 'client-id',
      scopes: ['read', 'write'],
    });

    expect(result?.oauth.scopes).toEqual(['read', 'write']);
  });
});
