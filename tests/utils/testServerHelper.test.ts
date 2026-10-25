import fs from 'fs';
import path from 'path';
import { TestServerHelper } from './testServerHelper.js';

jest.mock('../../src/server.js', () => ({
  AppServer: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
    connected: () => true,
    getApp: () => ({
      listen: () => ({
        address: () => ({ port: 3000 }),
        close: (callback: () => void) => callback(),
      }),
    }),
  })),
}));

describe('TestServerHelper configuration isolation', () => {
  it('keeps each instance configuration and cleanup independent', async () => {
    const first = new TestServerHelper();
    const second = new TestServerHelper();
    const originalPath = process.env.MCPHUB_SETTING_PATH;
    const firstSettings = { mcpServers: {}, systemConfig: { routing: { bearerAuthKey: 'first' } } };
    const secondSettings = {
      mcpServers: {},
      systemConfig: { routing: { bearerAuthKey: 'second' } },
    };

    try {
      await first.createTestServer(firstSettings);
      const firstPath = process.env.MCPHUB_SETTING_PATH!;
      await second.createTestServer(secondSettings);
      const secondPath = process.env.MCPHUB_SETTING_PATH!;

      expect(firstPath).not.toBe(secondPath);
      expect(JSON.parse(fs.readFileSync(firstPath, 'utf8'))).toEqual(firstSettings);
      expect(JSON.parse(fs.readFileSync(secondPath, 'utf8'))).toEqual(secondSettings);

      await second.closeTestServer();
      expect(fs.existsSync(path.dirname(secondPath))).toBe(false);
      expect(process.env.MCPHUB_SETTING_PATH).toBe(firstPath);
      expect(JSON.parse(fs.readFileSync(firstPath, 'utf8'))).toEqual(firstSettings);

      await first.closeTestServer();
      expect(fs.existsSync(path.dirname(firstPath))).toBe(false);
      expect(process.env.MCPHUB_SETTING_PATH).toBe(originalPath);
    } finally {
      await second.closeTestServer();
      await first.closeTestServer();
    }
  });
});
