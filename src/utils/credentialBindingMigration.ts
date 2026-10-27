import { createHash } from 'node:crypto';
import { In } from 'typeorm';
import { CredentialBindingDaoImpl } from '../dao/CredentialBindingDao.js';
import { getAppDataSource } from '../db/connection.js';
import { CredentialBinding } from '../db/entities/CredentialBinding.js';
import { CredentialBindingImport } from '../db/entities/CredentialBindingImport.js';
import type { StoredCredentialBinding } from '../types/index.js';
import { logger } from './logger.js';

const fingerprint = (binding: StoredCredentialBinding): string =>
  createHash('sha256')
    .update(JSON.stringify([binding.serverName, binding.username, binding.encryptedValues]))
    .digest('hex');

/** Import file credentials independently of user migration, using the runtime's existing key. */
export async function migrateCredentialBindings(): Promise<void> {
  const source = new CredentialBindingDaoImpl().readAll();
  if (source.length === 0) return;
  if (
    source.some(
      (binding) =>
        !binding ||
        typeof binding.serverName !== 'string' ||
        typeof binding.username !== 'string' ||
        typeof binding.encryptedValues !== 'string' ||
        typeof binding.updatedAt !== 'string',
    )
  ) {
    throw new Error('Invalid credential binding store; restore the original credentials file');
  }

  let imported = 0;
  await getAppDataSource().transaction(async (manager) => {
    // Serialize importers and binding writes until key validation and inserts are committed.
    await manager.query('LOCK TABLE "credential_bindings" IN SHARE ROW EXCLUSIVE MODE');
    const receipts = manager.getRepository(CredentialBindingImport);
    const fingerprints = source.map(fingerprint);
    const completed = new Set(
      (await receipts.find({ where: { fingerprint: In(fingerprints) } })).map(
        (receipt) => receipt.fingerprint,
      ),
    );
    const pending = source.filter((binding) => !completed.has(fingerprint(binding)));
    if (pending.length === 0) return;

    const repository = manager.getRepository(CredentialBinding);
    const existing = await repository.find();
    const identity = (binding: StoredCredentialBinding) =>
      JSON.stringify([binding.serverName, binding.username]);
    const occupied = new Set(existing.map(identity));
    const missing = pending.filter((binding) => {
      if (occupied.has(identity(binding))) return false;
      occupied.add(identity(binding));
      return true;
    });
    if (missing.length > 0) {
      const { decryptCredentialValues } = await import('../services/credentialBindingService.js');
      try {
        // Validate every candidate and destination before writing anything. Never generate a key.
        for (const binding of [...missing, ...existing]) await decryptCredentialValues(binding);
      } catch {
        throw new Error(
          'Credential migration aborted: file and database bindings must decrypt with the same original key. Restore MCPHUB_CREDENTIAL_ENCRYPTION_KEY or the original .credentials.key file; no credentials were imported',
        );
      }
      await repository.createQueryBuilder().insert().values(missing).orIgnore().execute();
    }
    await receipts.insert(
      [...new Set(pending.map(fingerprint))].map((value) => ({
        fingerprint: value,
        importedAt: new Date().toISOString(),
      })),
    );
    imported = missing.length;
  });
  if (imported > 0) {
    logger.log(
      `Imported ${imported} personal credential binding(s). The encryption key remains outside the database: persist and back it up separately. Source credential files were retained`,
    );
  }
}
