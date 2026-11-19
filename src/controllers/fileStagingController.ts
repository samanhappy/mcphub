import { constants as fsConstants } from 'node:fs';
import fs from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { pipeline } from 'node:stream/promises';

import type { NextFunction, Request, Response } from 'express';
import express from 'express';

import { openNoFollow } from '../services/fileStaging/paths.js';
import { logger } from '../utils/logger.js';
import {
  getFileStagingSettings,
  getStagingStateStore,
  isStagingRuntimeSupported,
} from '../services/fileStaging/settings.js';

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


const escapeHtml = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string,
  );

const humanBytes = (bytes: number): string => {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
};

/**
 * Browser upload page for a one-time token (#1056 PR2).
 *
 * Self-contained on purpose: the page must not load third-party assets, and a
 * nonce-scoped CSP keeps an injected string from becoming script. The token is
 * the only authority, so the page needs no hub session.
 */
const uploadPage = (token: string, filename: string, maxBytes: number): string => `
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Upload to MCPHub</title>
<style nonce="__NONCE__">
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 32px 16px; }
  main { max-width: 520px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  p.hint { margin: 0 0 24px; opacity: .75; }
  .card { border: 1px solid rgba(127,127,127,.35); border-radius: 10px; padding: 20px; }
  input[type=file] { display: block; width: 100%; margin: 12px 0; }
  button { font: inherit; padding: 9px 16px; border-radius: 8px; border: 1px solid rgba(127,127,127,.45); background: #2563eb; color: #fff; cursor: pointer; }
  button:disabled { opacity: .55; cursor: default; }
  progress { width: 100%; height: 10px; margin-top: 12px; }
  code { display: block; word-break: break-all; padding: 10px; border-radius: 8px; background: rgba(127,127,127,.15); margin: 8px 0; }
  .error { color: #dc2626; }
  .ok { color: #16a34a; }
  .row { display: flex; gap: 8px; align-items: center; margin-top: 12px; }
</style>
</head>
<body>
<main>
  <h1>Upload a file</h1>
  <p class="hint">${escapeHtml(filename)} &middot; up to ${escapeHtml(humanBytes(maxBytes))} &middot; link expires after one upload</p>
  <div class="card">
    <input id="file" type="file">
    <button id="send" disabled>Upload</button>
    <progress id="progress" value="0" max="100" hidden></progress>
    <div id="status" role="status" aria-live="polite"></div>
  </div>
</main>
<script nonce="__NONCE__">
(() => {
  const token = ${JSON.stringify(token)};
  const maxBytes = ${JSON.stringify(maxBytes)};
  const input = document.getElementById('file');
  const send = document.getElementById('send');
  const bar = document.getElementById('progress');
  const status = document.getElementById('status');
  input.addEventListener('change', () => {
    send.disabled = !input.files || input.files.length === 0;
    status.textContent = '';
  });
  send.addEventListener('click', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > maxBytes) {
      status.className = 'error';
      status.textContent = 'This file is larger than the link allows.';
      return;
    }
    send.disabled = true;
    bar.hidden = false;
    const xhr = new XMLHttpRequest();
    xhr.open('POST', location.pathname);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) bar.value = Math.round((event.loaded / event.total) * 100);
    };
    xhr.onload = () => {
      bar.hidden = true;
      let body = null;
      try { body = JSON.parse(xhr.responseText); } catch (_) { /* non-JSON error */ }
      if (xhr.status === 200 && body && body.success) {
        status.className = 'ok';
        status.textContent = 'Uploaded. Send this reference back to the assistant:';
        const code = document.createElement('code');
        code.textContent = body.data.ref;
        status.appendChild(code);
        send.textContent = 'Uploaded';
      } else {
        status.className = 'error';
        status.textContent = (body && body.message) || 'Upload failed. The link may have expired.';
        send.disabled = false;
      }
    };
    xhr.onerror = () => {
      bar.hidden = true;
      status.className = 'error';
      status.textContent = 'Upload failed. Check the connection and try again.';
      send.disabled = false;
    };
    xhr.send(file);
  });
})();
</script>
</body>
</html>`;

const cspForPage = (nonce: string): string =>
  `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;

/** Render the upload page for a live token without consuming it. */
export const showStagingUploadPage = async (req: Request, res: Response): Promise<void> => {
  const token = typeof req.params.token === 'string' ? req.params.token : '';
  try {
    if (!isStagingRuntimeSupported()) throw new Error('unsupported');
    const settings = await getFileStagingSettings();
    if (!settings.enabled) throw new Error('disabled');
    const store = await getStagingStateStore();
    const request = await store.getUploadToken(token);
    const ref = await store.getOwnedRef(request.ref, request.ownerHash);
    const nonce = randomBytes(16).toString('base64');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', cspForPage(nonce));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Robots-Tag', 'noindex');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200).send(
      uploadPage(token, ref.filename ?? 'file', settings.maxFileBytes).split('__NONCE__').join(nonce),
    );
  } catch {
    // Invalid, used and expired links look the same to the browser.
    res.status(404).type('text/plain').send('This upload link is not valid or has expired.');
  }
};

/**
 * Reject an unusable upload link before the body is buffered.
 *
 * `express.raw` allocates up to the limit for every request, so a route that
 * parsed first and checked the token afterwards would let anyone pull
 * `maxFileBytes` per request against an unknown token.
 */
export const assertStagingUploadLink = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  const token = typeof req.params.token === 'string' ? req.params.token : '';
  try {
    if (!isStagingRuntimeSupported()) throw new Error('unsupported');
    const settings = await getFileStagingSettings();
    if (!settings.enabled) throw new Error('disabled');
    const store = await getStagingStateStore();
    const request = await store.getUploadToken(token);
    const ref = await store.getOwnedRef(request.ref, request.ownerHash);
    if (ref.state !== 'reserved') throw new Error('not writable');
    const limit = ref.reservedBytes ?? settings.maxFileBytes;
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      res.status(413).json({ success: false, message: 'The file exceeds the staging limit.' });
      return;
    }
    // The parser and the ledger must agree on the ceiling for this link.
    (req as Request & { stagingUploadLimit?: number }).stagingUploadLimit = limit;
    next();
  } catch {
    res.status(404).json({ success: false, message: 'Upload link is not valid' });
  }
};

/**
 * Consume the token and finalize the reserved ref with the uploaded bytes.
 *
 * The body limit is per-request: it follows the live setting, so a large
 * configured maximum does not raise the global JSON body limit.
 */
export const rawStagingUploadBody = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  try {
    const settings = await getFileStagingSettings();
    const limit =
      (req as Request & { stagingUploadLimit?: number }).stagingUploadLimit ??
      settings.maxFileBytes;
    const parser = express.raw({ type: () => true, limit });
    parser(req, res, (error?: unknown) => {
      if (error) {
        const status = (error as { status?: number }).status === 413 ? 413 : 400;
        res.status(status).json({ success: false, message: 'Upload rejected' });
        return;
      }
      next();
    });
  } catch {
    res.status(404).json({ success: false, message: 'Upload link is not valid' });
  }
};

export const receiveStagedUpload = async (req: Request, res: Response): Promise<void> => {
  const token = typeof req.params.token === 'string' ? req.params.token : '';
  try {
    if (!isStagingRuntimeSupported()) throw new Error('unsupported');
    const settings = await getFileStagingSettings();
    if (!settings.enabled) throw new Error('disabled');
    const body: unknown = req.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw new Error('empty body');
    }
    const store = await getStagingStateStore();
    const record = await store.uploadWithToken(token, body, settings);
    res.status(200).json({
      success: true,
      data: { ref: record.ref, size: record.size, sha256: record.sha256 },
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    const message =
      code === 'expired'
        ? 'This upload link has expired.'
        : code === 'quota-exceeded'
          ? 'The file exceeds the staging limit.'
          : 'Upload link is not valid or has already been used.';
    res.status(code === 'quota-exceeded' ? 413 : 404).json({ success: false, message });
    logger.warn('[staging] rejected staged upload request');
  }
};
