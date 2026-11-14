import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';

import type { Request, Response } from 'express';

import { logger } from '../utils/logger.js';
import { getStagingStateStore } from '../services/fileStaging/settings.js';

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
  try {
    const store = await getStagingStateStore();
    const consumed = await store.consumeDownloadToken(token);
    const record = await store.getOwnedRef(consumed.ref, consumed.ownerHash);
    const file = await store.contentPathFor(record.ref, record.ownerHash);
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new Error('staged content is not a file');

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition(record.filename));
    res.setHeader('Content-Length', String(stat.size));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    createReadStream(file).pipe(res);
  } catch {
    // Missing, used, and expired tokens are indistinguishable to the caller.
    res.status(404).json({ success: false, message: 'Download link is not valid' });
    logger.warn('[staging] rejected staged download request');
  }
};
