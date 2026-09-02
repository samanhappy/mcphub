const mockRepository = {
  findByServerAndUsername: jest.fn(),
  findByUsername: jest.fn(),
  upsert: jest.fn(),
  delete: jest.fn(),
  deleteByServer: jest.fn(),
  deleteByUsername: jest.fn(),
  renameServer: jest.fn(),
};

jest.mock('../../src/db/repositories/CredentialBindingRepository.js', () => ({
  CredentialBindingRepository: jest.fn().mockImplementation(() => mockRepository),
}));

import { CredentialBindingDaoDbImpl } from '../../src/dao/CredentialBindingDaoDbImpl.js';

describe('CredentialBindingDaoDbImpl (#1114)', () => {
  it('persists and maps only the encrypted envelope for an exact principal', async () => {
    const encryptedValues = {
      version: 1 as const,
      iv: 'iv',
      ciphertext: 'ciphertext',
      authTag: 'tag',
    };
    mockRepository.upsert.mockResolvedValue({
      id: 'binding-1',
      serverName: 'personal-server',
      username: 'alice@example.com',
      encryptedValues,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    const dao = new CredentialBindingDaoDbImpl();

    const result = await dao.upsert('personal-server', 'alice@example.com', encryptedValues);

    expect(mockRepository.upsert).toHaveBeenCalledWith(
      'personal-server',
      'alice@example.com',
      encryptedValues,
    );
    expect(result).toEqual({
      id: 'binding-1',
      serverName: 'personal-server',
      username: 'alice@example.com',
      encryptedValues,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    });
    expect(JSON.stringify(result)).not.toContain('plaintext');
  });
});
