import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { FileStagingSettings } from '../../../types/index.js';
import { FileStagingStateStore } from '../stateStore.js';
import { executeStagingTool, isReservedStagingName, isStagingToolName } from '../tools.js';

const OWNER = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

const settings: FileStagingSettings = {
  enabled: true,
  maxFileBytes: 4096,
  inlineMaxBytes: 1024,
  perUserQuotaBytes: 65536,
  globalQuotaBytes: 262144,
  ttlHours: 1,
  downloadTtlSeconds: 300,
  maxFilesPerUser: 10,
  cleanupIntervalMinutes: 15,
};

const text = (result: any): Record<string, unknown> =>
  JSON.parse(result.content[0].text) as Record<string, unknown>;

describe('hub staging virtual tools', () => {
  let rootDir: string;
  let store: FileStagingStateStore;

  const context = (ownerHash = OWNER) => ({
    targets: [{ serverName: 'ssh', serverId: 'server-1', shared: false }],
    principal: { username: 'alice', ownerHash },
    settings,
    store,
    createDownloadUrl: async (ref: string) => ({
      downloadUrl: `https://hub.example/api/staging/download/${ref.slice(-8)}`,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
    }),
  });

  beforeEach(async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'mcphub-tools-'));
    rootDir = path.join(base, 'staging');
    store = new FileStagingStateStore({
      rootDir,
      stateDir: path.join(base, 'state'),
      disableLock: true,
    });
    await store.init();
  });

  afterEach(async () => {
    await fs.rm(path.dirname(rootDir), { recursive: true, force: true });
  });

  it('namespaces only the reserved hub prefix', () => {
    expect(isReservedStagingName('mcphub_file_upload')).toBe(true);
    expect(isReservedStagingName('mcphub_file_anything')).toBe(true);
    expect(isReservedStagingName('mcphub_tool')).toBe(false);
    expect(isStagingToolName('mcphub_file_upload')).toBe(true);
    expect(isStagingToolName('mcphub_file_anything')).toBe(false);
  });

  it('uploads, reports, and downloads a ready file', async () => {
    const uploaded = await executeStagingTool(
      'mcphub_file_upload',
      { filename: '../secret.txt', content_base64: Buffer.from('hello').toString('base64') },
      context(),
    );
    expect(uploaded.isError).toBeUndefined();
    const { ref } = text(uploaded);
    expect(ref).toMatch(/^mcpfile:\/\//);

    const status = await executeStagingTool('mcphub_file_status', { ref }, context());
    expect(text(status)).toMatchObject({ state: 'ready', size: 5 });

    const download = await executeStagingTool('mcphub_file_download', { ref }, context());
    expect(text(download).downloadUrl).toContain('/api/staging/download/');

    // Another principal sees the same generic not-found error.
    const foreign = await executeStagingTool('mcphub_file_download', { ref }, context(OTHER));
    expect(foreign.isError).toBe(true);
    expect(foreign.content[0].text).toBe('Staging reference not found');
  });

  it('reserves an empty destination that cannot be downloaded yet', async () => {
    const reserved = await executeStagingTool('mcphub_file_upload', { filename: 'out.csv' }, context());
    const { ref } = text(reserved);
    expect(text(reserved).state).toBe('reserved');
    const download = await executeStagingTool('mcphub_file_download', { ref }, context());
    expect(download.isError).toBe(true);
    expect(download.content[0].text).toBe('The staged file is not ready');
  });

  it('requires a server when the route has several staging targets', async () => {
    const multi = {
      ...context(),
      targets: [
        { serverName: 'ssh', serverId: 'server-1', shared: false },
        { serverName: 'sftp', serverId: 'server-2', shared: true },
      ],
    };
    const ambiguous = await executeStagingTool(
      'mcphub_file_upload',
      { filename: 'a.txt', content_base64: 'YQ==' },
      multi,
    );
    expect(ambiguous.isError).toBe(true);
    const chosen = await executeStagingTool(
      'mcphub_file_upload',
      { filename: 'a.txt', content_base64: 'YQ==', server: 'sftp' },
      multi,
    );
    expect(chosen.isError).toBeUndefined();
  });

  it('rejects a missing filename and an oversized inline payload', async () => {
    const missing = await executeStagingTool('mcphub_file_upload', {}, context());
    expect(missing.isError).toBe(true);
    const huge = Buffer.alloc(2048, 1).toString('base64');
    const oversized = await executeStagingTool(
      'mcphub_file_upload',
      { filename: 'big.bin', content_base64: huge },
      context(),
    );
    expect(oversized.isError).toBe(true);
    expect(oversized.content[0].text).toBe('File staging quota exceeded');
  });
});
