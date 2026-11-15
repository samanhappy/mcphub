import { resolveSyncedServerId } from '../../src/utils/settingsSync.js';
import { isLegacyServerId, legacyServerId } from '../../src/utils/serverIdentity.js';

/**
 * Settings sync writes the DB row directly, so it never goes through the DAO's
 * "materialize a UUID on first write" rule. A name-derived placeholder must not
 * be persisted or staging would refuse the server forever (#1056, R14).
 */
describe('resolveSyncedServerId', () => {
  it('gives a server that exists only in the declaration a random UUID', () => {
    const id = resolveSyncedServerId(undefined, undefined, 'remote');

    expect(id).toBeValidUUID();
    expect(isLegacyServerId(id, 'remote')).toBe(false);
  });

  it('ignores a legacy placeholder declared in the synced file', () => {
    const id = resolveSyncedServerId(undefined, legacyServerId('remote'), 'remote');

    expect(id).toBeValidUUID();
    expect(isLegacyServerId(id, 'remote')).toBe(false);
  });

  it('preserves the existing row id', () => {
    expect(resolveSyncedServerId('11111111-1111-4111-8111-111111111111', undefined, 'remote')).toBe(
      '11111111-1111-4111-8111-111111111111',
    );
  });

  it('preserves a declared UUID when the server is new', () => {
    expect(resolveSyncedServerId(undefined, '22222222-2222-4222-8222-222222222222', 'remote')).toBe(
      '22222222-2222-4222-8222-222222222222',
    );
  });
});
