import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';

const mockGetStagingStateStore = jest.fn();

jest.mock('../../src/services/fileStaging/settings.js', () => ({
  getStagingStateStore: (...args: unknown[]) => mockGetStagingStateStore(...args),
}));

import { downloadStagedFile } from '../../src/controllers/fileStagingController.js';

const OWNER = 'a'.repeat(64);

const appWith = () => {
  const app = express();
  app.get('/api/staging/download/:token', downloadStagedFile);
  return app;
};

describe('staged file download endpoint', () => {
  let file: string;

  beforeEach(async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcphub-download-'));
    file = path.join(dir, 'content');
    await fs.writeFile(file, 'download body');
  });

  afterEach(async () => {
    await fs.rm(path.dirname(file), { recursive: true, force: true });
  });

  it('serves a ready file as an attachment with nosniff and no-store', async () => {
    mockGetStagingStateStore.mockResolvedValue({
      consumeDownloadToken: jest.fn(async () => ({ ref: 'mcpfile://x', ownerHash: OWNER })),
      getOwnedRef: jest.fn(async () => ({ filename: 'report "final".csv' })),
      contentPathFor: jest.fn(async () => file),
    });

    const response = await request(appWith()).get('/api/staging/download/token-1');
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toBe('application/octet-stream');
    expect(response.headers['content-disposition']).toContain('attachment;');
    expect(response.headers['content-disposition']).toContain("filename*=UTF-8''");
    expect(response.headers['content-disposition']).not.toMatch(/["\\]final["\\]/);
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.toString('utf8')).toBe('download body');
  });

  it('returns the same 404 for an unknown, used, or expired token', async () => {
    mockGetStagingStateStore.mockResolvedValue({
      consumeDownloadToken: jest.fn(async () => {
        throw new Error('not found');
      }),
    });
    const response = await request(appWith()).get('/api/staging/download/token-2');
    expect(response.status).toBe(404);
    expect(response.body).toEqual({ success: false, message: 'Download link is not valid' });
  });
});
