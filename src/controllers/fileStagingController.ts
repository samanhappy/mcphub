import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

import type { Request, Response } from 'express';

import { openNoFollow } from '../services/fileStaging/paths.js';
import { logger } from '../utils/logger.js';
import { getStagingStateStore, isStagingRuntimeSupported } from '../services/fileStaging/settings.js';

/**
 * RFC 5987 `attr-char` escaping. `encodeURIComponent` leaves `'()*` and `!`
 * unescaped, which are not `attr-char` and make strict clients reject the
 * header; the ASCII fallback keeps a printable name for old clients.
 */
const encodeFilenameStar = (value: string): string =>
  encodeURIComponent(value).replace(
    /['()*!]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

const contentDisposition = (filename: string | undefined): string => {
  const fallback = (filename ?? 'download.bin').replace(/[^\x20-\x7e]|["\\]/g, '_') || 'download.bin';
  const encoded = encodeFilenameStar(filename ?? 'download.bin');
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
  let releasePin: (() => Promise<void>) | undefined;
  try {
    // A token minted before the deployment mode changed must not be served by
    // a replica that shares the ledger but not the staging root.
    if (!isStagingRuntimeSupported()) {
      res.status(404).json({ success: false, message: 'File not found' });
      return;
    }
    const store = await getStagingStateStore();
    const consumed = await store.consumeDownloadToken(token);
    // Pin before opening: cleanup must not delete the file between the digest
    // check and the stream.
    const record = await store.pinReadyRef(consumed.ref, consumed.ownerHash);
    releasePin = () => store.unpinRef(record.ref);
    const file = await store.contentPathFor(record.ref, record.ownerHash);
    // One open for both the digest and the body: hashing one handle and
    // streaming another leaves a window where a same-UID writer swaps the
    // file between the two opens (reproduced by the maintainer: 22/100
    // responses served, 6 of them with a different hash).
    // Same fail-closed opener as the ledger: on a platform without O_NOFOLLOW
    // this throws instead of silently following a leaf symlink.
    const handle = await openNoFollow(file, fsConstants.O_RDONLY);
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || stat.size !== record.size) {
        throw new Error('staged content is not a regular single-link file');
      }
      const hash = createHash('sha256');
      await pipeline(handle.createReadStream({ start: 0, autoClose: false }), hash);
      if (hash.digest('hex') !== consumed.contentHash) {
        throw new Error('staged content changed after the download token was issued');
      }

      res.setHeader('Content-Type', 'application/octet-stream');
      res.setHeader('Content-Disposition', contentDisposition(record.filename));
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // A staged HTML/SVG file must never run on the hub origin, and the link
      // must not be cached or indexed by an intermediary.
      res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('X-Robots-Tag', 'noindex');
      res.setHeader('Referrer-Policy', 'no-referrer');
      // Same handle, explicit position: a concurrent rename/replace cannot
      // redirect the body to different bytes.
      await pipeline(handle.createReadStream({ start: 0, autoClose: false }), res);
    } finally {
      await handle.close();
    }
  } catch {
    // Missing, used, and expired tokens are indistinguishable to the caller.
    if (res.headersSent) {
      res.destroy();
    } else {
      res.status(404).json({ success: false, message: 'Download link is not valid' });
    }
    logger.warn('[staging] rejected staged download request');
  } finally {
    // A failing unpin must not replace the response that was already sent.
    await releasePin?.().catch((error) => {
      logger.warn('[staging] failed to release a download pin', error);
    });
  }
};
