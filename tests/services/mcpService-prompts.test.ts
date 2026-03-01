jest.mock('../../src/services/oauthService.js', () => ({
  initializeAllOAuthClients: jest.fn(),
}));

jest.mock('../../src/services/mcpOAuthProvider.js', () => ({
  createOAuthProvider: jest.fn(),
}));

jest.mock('../../src/services/sseService.js', () => ({
  getGroup: jest.fn(() => ''),
}));

jest.mock('../../src/services/groupService.js', () => ({
  getServersInGroup: jest.fn(),
  getServerConfigInGroup: jest.fn(),
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  saveToolsAsVectorEmbeddings: jest.fn(),
}));

jest.mock('../../src/services/activityLoggingService.js', () => ({
  getActivityLoggingService: jest.fn(() => ({
    logToolCall: jest.fn(),
  })),
}));

jest.mock('../../src/services/smartRoutingService.js', () => ({
  initSmartRoutingService: jest.fn(),
  getSmartRoutingTools: jest.fn(),
  handleSearchToolsRequest: jest.fn(),
  handleDescribeToolRequest: jest.fn(),
  isSmartRoutingGroup: jest.fn(() => false),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({
    filterData: (data: any) => data,
  })),
}));

const mockGetBuiltinPromptDao = {
  findEnabled: jest.fn(),
};

const mockGetBuiltinResourceDao = {
  findEnabled: jest.fn(),
};

const mockGetServerDao = {
  findById: jest.fn(),
};

jest.mock('../../src/dao/index.js', () => ({
  getServerDao: jest.fn(() => mockGetServerDao),
  getSystemConfigDao: jest.fn(() => ({ get: jest.fn() })),
  getBuiltinPromptDao: jest.fn(() => mockGetBuiltinPromptDao),
  getBuiltinResourceDao: jest.fn(() => mockGetBuiltinResourceDao),
}));

jest.mock('../../src/config/index.js', () => ({
  expandEnvVars: jest.fn((val: string) => val),
  replaceEnvVars: jest.fn((val: any) => val),
  getNameSeparator: jest.fn(() => '::'),
  default: {
    mcpHubName: 'test-hub',
    mcpHubVersion: '1.0.0',
    initTimeout: 60000,
  },
}));

import {
  handleListPromptsRequest,
  handleListResourcesRequest,
} from '../../src/services/mcpService.js';

describe('mcpService handleListPromptsRequest', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetServerDao.findById.mockResolvedValue(null);
    mockGetBuiltinResourceDao.findEnabled.mockResolvedValue([]);
  });

  it('should return schema-safe prompt fields for built-in prompts', async () => {
    mockGetBuiltinPromptDao.findEnabled.mockResolvedValue([
      {
        id: 'p1',
        name: 'builtin-no-optional-fields',
        template: 'hello {{x}}',
        enabled: true,
        title: undefined,
        description: undefined,
        arguments: undefined,
      },
    ]);

    const result = await handleListPromptsRequest({}, { sessionId: 's1' });

    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0]).toEqual({
      name: 'builtin-no-optional-fields',
      title: 'builtin-no-optional-fields',
      description: '',
      arguments: [],
    });
    expect(typeof result.prompts[0].title).toBe('string');
    expect(typeof result.prompts[0].description).toBe('string');
    expect(Array.isArray(result.prompts[0].arguments)).toBe(true);
  });

  it('should return schema-safe resource fields for built-in resources', async () => {
    mockGetBuiltinPromptDao.findEnabled.mockResolvedValue([]);
    mockGetBuiltinResourceDao.findEnabled.mockResolvedValue([
      {
        id: 'r1',
        uri: 'resource://docs/readme',
        content: 'hello',
        enabled: true,
        name: null,
        description: undefined,
        mimeType: null,
      },
    ]);

    const result = await handleListResourcesRequest({}, { sessionId: 's1' });

    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]).toEqual({
      uri: 'resource://docs/readme',
      name: '',
      description: '',
      mimeType: '',
    });
    expect(typeof result.resources[0].name).toBe('string');
    expect(typeof result.resources[0].description).toBe('string');
    expect(typeof result.resources[0].mimeType).toBe('string');
  });
});
