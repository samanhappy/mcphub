import {
  decryptCredentialValues,
  encryptCredentialValues,
} from '../../src/services/credentialCrypto.js';

describe('credentialCrypto (#1114)', () => {
  const context = { username: 'alice@example.com' };
  const values = {
    env: { TAVILY_API_KEY: 'alice-tavily-secret' },
    headers: { Authorization: 'Bearer alice-header-secret' },
  };

  it('round-trips credential values without persisting plaintext', () => {
    const encrypted = encryptCredentialValues(values, context);

    expect(JSON.stringify(encrypted)).not.toContain('alice-tavily-secret');
    expect(JSON.stringify(encrypted)).not.toContain('alice-header-secret');
    expect(decryptCredentialValues(encrypted, context)).toEqual(values);
  });

  it('authenticates ciphertext and reports a non-sensitive failure', () => {
    const encrypted = encryptCredentialValues(values, context);
    const tampered = {
      ...encrypted,
      ciphertext: `${encrypted.ciphertext.slice(0, -2)}AA`,
    };

    expect(() => decryptCredentialValues(tampered, context)).toThrow(
      'Credential binding cannot be read',
    );
    expect(() => decryptCredentialValues(tampered, context)).not.toThrow('alice-tavily-secret');
  });

  it('binds ciphertext authentication to the exact principal', () => {
    const encrypted = encryptCredentialValues(values, context);

    expect(() =>
      decryptCredentialValues(encrypted, { ...context, username: 'bob@example.com' }),
    ).toThrow('Credential binding cannot be read');
  });
});
