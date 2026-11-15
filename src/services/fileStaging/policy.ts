import type { FileStagingSettings } from '../../types/index.js';
import { type StagingRefRecord, StagingError } from './types.js';

/**
 * Pure lease/finalize decisions shared by the file and database ledgers so the
 * two backends cannot drift on the security-critical rules (#1056).
 */

export interface LeaseRequestItemLike {
  ref: string;
  leaseId: string;
}

export interface RefDigest {
  size: number;
  sha256: string;
}

/** Validate the full output set before any lease is written. */
export const assertRefsLeasable = (
  records: readonly StagingRefRecord[],
  items: readonly LeaseRequestItemLike[],
  ownerHash: string,
  nowIso: string,
): void => {
  const seen = new Set<string>();
  for (const record of records) {
    if (record.ownerHash !== ownerHash) {
      // Same error as a missing ref: never confirm another principal's ref.
      throw new StagingError('not-found', 'Staging reference not found');
    }
    if (seen.has(record.ref)) {
      throw new StagingError('invalid-ref', 'The same staging reference was used twice');
    }
    seen.add(record.ref);
    if (record.state !== 'reserved') {
      throw new StagingError('not-reserved', 'Output destination is not writable');
    }
    if (record.leaseId) {
      throw new StagingError('lease-conflict', 'Output destination is busy');
    }
    if (record.expiresAt <= nowIso) {
      throw new StagingError('expired', 'Staging reference has expired');
    }
  }
  if (records.length !== items.length) {
    throw new StagingError('not-found', 'Staging reference not found');
  }
};

/**
 * Quota is reserved at the worst-case size before the child can write, then
 * adjusted at finalize. The check is a real reservation, not post-hoc
 * accounting, so concurrent calls cannot both pass it.
 */
export const assertLeaseQuota = (
  ownerUsed: number,
  globalUsed: number,
  leaseCount: number,
  settings: FileStagingSettings,
): void => {
  const reserve = settings.maxFileBytes * leaseCount;
  if (ownerUsed + reserve > settings.perUserQuotaBytes) {
    throw new StagingError('quota-exceeded', 'Per-user staging quota exceeded');
  }
  if (globalUsed + reserve > settings.globalQuotaBytes) {
    throw new StagingError('quota-exceeded', 'Global staging quota exceeded');
  }
};

export interface FinalizeDecision {
  size: number;
  sha256: string;
}

/**
 * Validate one tool-written output and return the fields to record. Throws when
 * the file is oversized, empty without allow_zero_byte, or the caller no
 * longer holds the lease.
 */
export const decideFinalize = (
  record: StagingRefRecord,
  leaseId: string,
  digest: RefDigest,
  settings: FileStagingSettings,
): FinalizeDecision => {
  if (record.leaseId !== leaseId) {
    throw new StagingError('lease-conflict', 'This call no longer holds the output lease');
  }
  if (record.state !== 'reserved') {
    throw new StagingError('not-reserved', 'Output destination is not writable');
  }
  if (digest.size > settings.maxFileBytes) {
    throw new StagingError('quota-exceeded', 'Output file exceeds the configured limit');
  }
  if (digest.size === 0 && !record.allowZeroByte) {
    throw new StagingError('not-ready', 'Tool produced an empty output');
  }
  return { size: digest.size, sha256: digest.sha256 };
};
