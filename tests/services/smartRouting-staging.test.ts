/**
 * A $smart route exposes hub built-in staging tools directly, and describe_tool
 * must answer for them instead of reporting "not found" (#1056 PR3).
 */
import { describe, expect, it, jest } from '@jest/globals';

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(() => ({ findAll: jest.fn(async () => []), findById: jest.fn(async () => undefined) })),
  getGroupDao: jest.fn(() => ({ findByName: jest.fn(async () => undefined), findById: jest.fn(async () => undefined) })),
  getSystemConfigDao: jest.fn(() => ({ get: jest.fn(async () => ({})) })),
}));
jest.mock('../../src/services/vectorSearchService.js', () => ({
  searchToolsByVector: jest.fn(async () => []),
}));
jest.mock('../../src/services/toolPolicyService.js', () => ({
  getToolPolicy: jest.fn(async () => ({ active: false })),
}));
jest.mock('../../src/services/groupService.js', () => ({
  getServerConfigsInGroup: jest.fn(async () => []),
  getServerConfigInGroup: jest.fn(async () => undefined),
  getServersInGroup: jest.fn(async () => []),
  normalizeGroupServers: jest.fn((servers: any[]) => servers),
  notifyToolChanged: jest.fn(),
}));
jest.mock('../../src/services/oauthService.js', () => ({ initializeAllOAuthClients: jest.fn() }));
jest.mock('../../src/services/mcpOAuthProvider.js', () => ({ createOAuthProvider: jest.fn() }));
jest.mock('../../src/services/cloudService.js', () => ({
  getCloudService: jest.fn(() => ({ isEnabled: false })),
}));
jest.mock('../../src/services/changelogService.js', () => ({
  getChangelogService: jest.fn(() => ({ getChangelog: jest.fn() })),
}));
jest.mock('../../src/services/hostedMode.js', () => ({ isHostedModeEnabled: jest.fn(() => false) }));
jest.mock('../../src/services/hostedControlPlaneClient.js', () => ({
  getHostedControlPlaneClient: jest.fn(),
}));
jest.mock('../../src/services/proxy.js', () => ({
  normalizeHeaders: jest.fn((h: any) => h),
  createFetchWithProxy: jest.fn(),
  getProxyConfigFromEnv: jest.fn(),
}));
jest.mock('../../src/config/index.js', () => ({
  __esModule: true,
  default: { mcpHubName: 'test', mcpHubVersion: '1.0.0', basePath: '' },
  expandEnvVars: jest.fn((v: string) => v),
  replaceEnvVars: jest.fn((v: any) => v),
  getNameSeparator: jest.fn(() => '-'),
  loadSettings: jest.fn(),
  getSettingsPath: jest.fn(),
}));
jest.mock('../../src/utils/mcpApps.js', () => ({
  MCP_APPS_CAPABILITIES: {},
  filterModelVisibleTools: jest.fn((_: any, tools: any[]) => tools),
  hasMcpAppsCapability: jest.fn(() => false),
  isAppOnlyTool: jest.fn(() => false),
  stripMcpAppsMetadata: jest.fn((t: any) => t),
}));

import { handleDescribeToolRequest } from '../../src/services/smartRoutingService.js';

describe('describe_tool for hub built-ins', () => {
  it('returns the static definition instead of a not-found error', async () => {
    const result = await handleDescribeToolRequest('mcphub_file_request_upload', 's1');

    expect(result.tool).toMatchObject({
      name: 'mcphub_file_request_upload',
      server: 'mcphub',
    });
    expect(result.tool.inputSchema.properties).toHaveProperty('filename');
    expect(result.tool.inputSchema.properties).toHaveProperty('size_hint');
  });

  it('still resolves ordinary tools through the routing path', async () => {
    // No server is registered in this harness, so the lookup reports the tool
    // as unavailable rather than returning the built-in definition.
    const result = await handleDescribeToolRequest('some-upstream-tool', 's1');
    expect(result.tool?.name).not.toBe('some-upstream-tool');
    expect(result.success ?? false).toBe(false);
  });
});
