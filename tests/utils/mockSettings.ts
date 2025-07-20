import { McpSettings, ServerConfig, SystemConfig, IGroup, IUser } from '../../src/types/index.js';

/**
 * Creates mock MCP settings for testing
 * @param overrides Optional configuration overrides
 * @returns Mock McpSettings object
 */
export const createMockSettings = (overrides: Partial<McpSettings> = {}): McpSettings => {
  const defaultSettings: McpSettings = {
    mcpServers: {
      'test-server-1': {
        command: 'npx',
        args: ['-y', 'time-mcp'],
        env: {},
        enabled: true,
        keepAliveInterval: 30000,
        type: 'stdio',
      } as ServerConfig,
    },
    groups: [
      {
        name: 'integration-test-group',
        servers: ['test-server-1'],
        description: 'Test group for integration tests',
        owner: 'admin',
      } as IGroup,
    ],
    systemConfig: {
      routing: {
        enableGlobalRoute: true,
        enableGroupNameRoute: true,
        enableBearerAuth: true,
        bearerAuthKey: 'test-auth-token-123',
      },
    } as SystemConfig,
    users: [
      {
        username: 'testuser',
        password: 'testpass',
        isAdmin: false,
      } as IUser,
    ],
  };

  return {
    ...defaultSettings,
    ...overrides,
    mcpServers: {
      ...defaultSettings.mcpServers,
      ...(overrides.mcpServers || {}),
    },
    groups: [...(defaultSettings.groups || []), ...(overrides.groups || [])],
    systemConfig: {
      ...defaultSettings.systemConfig,
      ...(overrides.systemConfig || {}),
    },
  };
};

/**
 * Creates mock settings with bearer authentication enabled
 */
export const createMockSettingsWithAuth = (bearerKey = 'test-auth-token-123'): McpSettings => {
  return createMockSettings({
    systemConfig: {
      routing: {
        enableGlobalRoute: true,
        enableGroupNameRoute: true,
        enableBearerAuth: true,
        bearerAuthKey: bearerKey,
      },
    },
  });
};

/**
 * Creates mock settings with global routes disabled
 */
export const createMockSettingsNoGlobalRoutes = (): McpSettings => {
  return createMockSettings({
    systemConfig: {
      routing: {
        enableGlobalRoute: false,
        enableGroupNameRoute: true,
        enableBearerAuth: false,
        bearerAuthKey: '',
      },
    },
  });
};

/**
 * Mock settings helper for specific test scenarios
 */
export const getMockSettingsForScenario = (
  scenario: 'auth' | 'no-global' | 'basic',
): McpSettings => {
  switch (scenario) {
    case 'auth':
      return createMockSettingsWithAuth();
    case 'no-global':
      return createMockSettingsNoGlobalRoutes();
    case 'basic':
    default:
      return createMockSettings();
  }
};
