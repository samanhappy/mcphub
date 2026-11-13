import type { FileStagingSettings } from '../../types/index.js';

/** Lifecycle of a staged file (#1056). */
export type StagingRefState = 'reserved' | 'ready' | 'failed' | 'expired';

/**
 * Authoritative hub-side record for one staged file. This is the source of
 * truth; the on-disk `meta.json` is only a cache and may be tampered with by a
 * same-UID tool.
 */
export interface StagingRefRecord {
  /** `mcpfile://<uuid>` */
  ref: string;
  /** Bare uuid; also the directory name under the principal root. */
  id: string;
  ownerHash: string;
  serverId: string;
  serverName: string;
  /** Recorded at the first rewrite/finalize for audit only. */
  toolName?: string;
  /** Display only; never used as a path component. */
  filename?: string;
  state: StagingRefState;
  size: number;
  sha256?: string;
  version: number;
  /** Allow a zero-byte output to finalize as ready. */
  allowZeroByte: boolean;
  /** Quota reserved while an output lease is held. */
  reservedBytes?: number;
  createdAt: string;
  expiresAt: string;
  /** Exclusive output lease held by one call. */
  leaseId?: string;
  /** Diagnostic/crash backstop only; never used as a runtime TTL. */
  leaseUntil?: string;
  /** Read pins protect ready content from cleanup during inputs/downloads. */
  pinCount: number;
  pinUntil?: string;
}

export interface StagingTokenRecord {
  tokenHash: string;
  kind: 'download';
  ref: string;
  ownerHash: string;
  version: number;
  contentHash: string;
  expiresAt: string;
  usedAt?: string;
}

export interface StagingStateDocument {
  version: 1;
  refs: Record<string, StagingRefRecord>;
  tokens: Record<string, StagingTokenRecord>;
}

export interface StagingPrincipal {
  /** Stable hash; never a raw username. */
  ownerHash: string;
}

export interface CreateRefInput {
  principal: StagingPrincipal;
  serverId: string;
  serverName: string;
  filename?: string;
  allowZeroByte?: boolean;
  settings: FileStagingSettings;
}

export interface LeaseRequestItem {
  ref: string;
  leaseId: string;
}

export interface LeaseGrant {
  ref: string;
  id: string;
  ownerHash: string;
  contentPath: string;
}

export type StagingErrorCode =
  | 'not-found'
  | 'not-ready'
  | 'not-reserved'
  | 'lease-conflict'
  | 'quota-exceeded'
  | 'invalid-ref'
  | 'owner-mismatch'
  | 'server-mismatch'
  | 'expired'
  | 'locked';

/** Expected failures; the tool/HTTP layer maps these to generic public errors. */
export class StagingError extends Error {
  constructor(
    readonly code: StagingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StagingError';
  }
}
