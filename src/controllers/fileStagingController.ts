import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';

import type { Request, Response } from 'express';

import { logger } from '../utils/logger.js';
import { getStagingStateStore } from '../services/fileStaging/settings.js';
import { digestFile } from '../services/fileStaging/paths.js';

const contentDisposition = (filename: string | undefined): string => {
  const fallback = (filename ?? 'download').replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(filename ?? 'download');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
};

/**
 * One-time staged file download (#1056).
 *
 * The URL carries an unguessable, single-use token; possession of it is the
 * capability, so this route is intentionally outside the dashboard auth
 * middleware. Files are always served as attachments with `nosniff` to keep a
 * staged HTML/SVG file from executing on the hub origin.
 */
export const downloadStagedFile = async (req: Request, res: Response): Promise<void> => {
  const token = typeof req.params.token === 'string' ? req.params.token : '';
  // A HEAD would consume the one-time token without delivering anything.
  if (req.method === 'HEAD') {
    res.status(405).end();
    return;
  }
  try {
    const store = await getStagingStateStore();
    const consumed = await store.consumeDownloadToken(token);
    const record = await store.getOwnedRef(consumed.ref, consumed.ownerHash);
    const file = await store.contentPathFor(record.ref, record.ownerHash);
    // Re-verify at read time: O_NOFOLLOW, single-link regular file, and the
    // same bytes the token was minted for. A tool sharing the UID could
    // otherwise swap the content after finalization.
    const digest = await digestFile(file);
    if (digest.sha256 !== consumed.contentHash || digest.size !== record.size) {
      throw new Error('staged content changed after the download token was issued');
    }

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(record.filename));
    res.setHeader('Content-Length', String(digest.size));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const handle = await fs.open(file, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    handle.createReadStream().pipe(res);
  } catch {
    // Missing, used, and expired tokens are indistinguishable to the caller.
    res.status(404).json({ success: false, message: 'Download link is not valid' });
    logger.warn('[staging] rejected staged download request');
  }
};
