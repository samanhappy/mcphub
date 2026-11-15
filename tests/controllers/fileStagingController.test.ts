import { createHash } from 'node:crypto';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

const mockGetStagingStateStore = jest.fn();

jest.mock('../../src/services/fileStaging/settings.js', () => ({
  getStagingStateStore: (...args: unknown[]) => mockGetStagingStateStore(...args),
  isStagingRuntimeSupported: () => true,
}));

import { downloadStagedFile } from '../../src/controllers/fileStagingController.js';

const OWNER = 'a'.repeat(64);
const sha256 = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');

// The route is mounted at `${basePath}/staging/download/:token` and basePath is
// empty by default, so the production path has no `/api` prefix.
const appWith = () => {
  const app = express();
  app.get('/staging/download/:token', downloadStagedFile);
  return app;
};

const storeWith = (file: string, body: Buffer, filename = 'report.csv') => {
  const pinReadyRef = jest.fn(async () => ({ ref: 'mcpfile://x', filename, size: body.length }));
  const unpinRef = jest.fn(async () => undefined);
  return {
    consumeDownloadToken: jest.fn(async () => ({
      ref: 'mcpfile://x',
      ownerHash: OWNER,
      contentHash: sha256(body),
    })),
    getOwnedRef: jest.fn(async () => ({ filename, size: body.length })),
    pinReadyRef,
    unpinRef,
    contentPathFor: jest.fn(async () => file),
  };
};

describe('staged file download endpoint', () => {
  let dir: string;
  let file: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcphub-download-'));
    file = path.join(dir, 'content');
    await fs.writeFile(file, 'download body');
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('serves a ready file as an attachment with nosniff and no-store', async () => {
    const body = Buffer.from('download body');
    mockGetStagingStateStore.mockResolvedValue(storeWith(file, body, 'report "final".csv'));

    const response = await request(appWith()).get('/staging/download/token-1');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/octet-stream');
    expect(response.headers['content-disposition']).toContain('attachment;');
    expect(response.headers['content-disposition']).toContain("filename*=UTF-8''");
    expect(response.headers['content-disposition']).not.toMatch(/["\\]final["\\]/);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['content-security-policy']).toContain("default-src 'none'");
    expect(response.headers['x-robots-tag']).toBe('noindex');
    expect(response.body.toString('utf8')).toBe('download body');
  });

  it('escapes RFC 5987 attr-chars in filename*', async () => {
    const body = Buffer.from('download body');
    mockGetStagingStateStore.mockResolvedValue(
      storeWith(file, body, "o'brien (final)*.txt"),
    );
    const response = await request(appWith()).get('/staging/download/token-1');
    expect(response.status).toBe(200);
    const disposition = response.headers['content-disposition'] as string;
    // ' ( ) * are not attr-char and must be percent-encoded.
    expect(disposition).toContain("filename*=UTF-8''");
    expect(disposition.split("filename*=UTF-8''")[1]).not.toMatch(/['()*]/);
  });

  it('pins the ref before streaming and releases the pin afterwards', async () => {
    const body = Buffer.from('download body');
    const store = storeWith(file, body);
    mockGetStagingStateStore.mockResolvedValue(store);
    const response = await request(appWith()).get('/staging/download/token-1');
    expect(response.status).toBe(200);
    expect(store.pinReadyRef).toHaveBeenCalledTimes(1);
    // The unpin runs after the response stream closes, which can be a tick
    // after the client has received the body.
    for (let attempt = 0; attempt < 20 && store.unpinRef.mock.calls.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(store.unpinRef).toHaveBeenCalledTimes(1);
    expect(store.pinReadyRef.mock.invocationCallOrder[0]).toBeLessThan(
      store.contentPathFor.mock.invocationCallOrder[0],
    );
  });

  it('refuses content whose hash no longer matches the token', async () => {
    await fs.writeFile(file, 'other bytes!!');
    mockGetStagingStateStore.mockResolvedValue(storeWith(file, Buffer.from('download body')));
    const response = await request(appWith()).get('/staging/download/token-1');
    expect(response.status).toBe(404);
  });

  it('refuses a same-length replacement made after the token was minted', async () => {
    const original = Buffer.from('download body');
    const replacement = Buffer.from('tampered body');
    expect(replacement.length).toBe(original.length);
    const store = storeWith(file, original);
    mockGetStagingStateStore.mockResolvedValue(store);
    await fs.writeFile(file, replacement);
    const response = await request(appWith()).get('/staging/download/token-1');
    expect(response.status).toBe(404);
    expect(response.text).not.toContain('tampered');
  });

  it('does not consume the token for a HEAD request', async () => {
    const body = Buffer.from('download body');
    const store = storeWith(file, body);
    mockGetStagingStateStore.mockResolvedValue(store);
    const response = await request(appWith()).head('/staging/download/token-1');
    expect(response.status).toBe(405);
    expect(store.consumeDownloadToken).not.toHaveBeenCalled();
  });

  it('returns the same 404 for an unknown, used, or expired token', async () => {
    mockGetStagingStateStore.mockResolvedValue({
      consumeDownloadToken: jest.fn(async () => {
        throw new Error('not found');
      }),
    });
    const response = await request(appWith()).get('/staging/download/token-2');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ success: false, message: 'Download link is not valid' });
  });
});
