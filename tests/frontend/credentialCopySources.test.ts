import { getCredentialCopySources } from '../../frontend/src/utils/credentialCopySources';
import type { MyCredentialBinding, CredentialSlot } from '../../frontend/src/types';

const binding = (
  serverName: string,
  slots: CredentialSlot[],
  configured = true,
): MyCredentialBinding => ({
  serverName,
  credentialTemplate: slots,
  configured,
  configuredSlots: configured ? slots.map((slot) => `${slot.target}.${slot.name}`) : [],
  updatedAt: configured ? '2026-11-03T12:00:00Z' : null,
});

test('keeps unavailable sources and explains a field-name mismatch despite matching labels', () => {
  const target = binding('playwright', [{ target: 'env', name: 't', label: 't' }]);
  const source = binding('amap', [{ target: 'env', name: 'test', label: 't' }]);
  const result = getCredentialCopySources(target, [target, source]);
  expect(result).toEqual([{ source, reason: 'missing', missing: ['env.t'] }]);
});

test('distinguishes an unconfigured source from compatible and URL-incompatible sources', () => {
  const slots: CredentialSlot[] = [{ target: 'url', name: 'region', allowed: ['us'] }];
  const target = binding('target', slots);
  const pending = binding('pending', slots, false);
  const compatible = binding('compatible', slots);
  const regional = binding('regional', [{ target: 'url', name: 'region', allowed: ['us', 'eu'] }]);
  expect(
    getCredentialCopySources(target, [pending, compatible, regional]).map(({ reason }) => reason),
  ).toEqual(['unconfigured', undefined, 'url']);
});

test('matches header names case-insensitively and permits extra source fields', () => {
  const target = binding('target', [{ target: 'headers', name: 'x-api-key' }]);
  const source = binding('source', [
    { target: 'headers', name: 'X-API-Key' },
    { target: 'headers', name: 'Extra' },
  ]);
  expect(getCredentialCopySources(target, [source])[0].reason).toBeUndefined();
});
