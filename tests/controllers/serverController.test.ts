import { Request, Response } from 'express';

const mockServerDao = {
  findById: jest.fn(),
  updateTools: jest.fn(),
  updatePrompts: jest.fn(),
  updateResources: jest.fn(),
};

const mockSystemConfigDao = {
  get: jest.fn(),
  update: jest.fn(),
};

const mockNotifyToolChanged = jest.fn();
const mockSyncToolEmbedding = jest.fn();
const mockGetServerByName = jest.fn();

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getServerDao: jest.fn(() => mockServerDao),
  getGroupDao: jest.fn(),
  getSystemConfigDao: jest.fn(() => mockSystemConfigDao),
  getBearerKeyDao: jest.fn(),
}));

jest.mock('../../src/services/mcpService.js', () => ({
  getServersInfo: jest.fn(),
  addServer: jest.fn(),
  addOrUpdateServer: jest.fn(),
  removeServer: jest.fn(),
  getServerByName: jest.fn(() => mockGetServerByName()),
  notifyToolChanged: jest.fn(() => mockNotifyToolChanged()),
  syncToolEmbedding: jest.fn((...args: unknown[]) => mockSyncToolEmbedding(...args)),
  toggleServerStatus: jest.fn(),
  reconnectServer: jest.fn(),
}));

import {
  resetPromptDescription,
  resetResourceDescription,
  resetToolDescription,
  updateSystemConfig,
} from '../../src/controllers/serverController.js';

describe('serverController - updateSystemConfig', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnThis();

    mockRequest = {
      body: {
        routing: {
          bearerAuthHeaderName: 'X-MCP-Authorization',
          jsonBodyLimit: '2mb',
        },
      },
    };

    mockResponse = {
      json: mockJson,
      status: mockStatus,
    };

    mockSystemConfigDao.get.mockResolvedValue({
      routing: {
        enableGlobalRoute: true,
        enableGroupNameRoute: true,
        enableBearerAuth: true,
        bearerAuthKey: '',
        bearerAuthHeaderName: 'Authorization',
        jsonBodyLimit: '1mb',
        skipAuth: false,
      },
    });
    mockSystemConfigDao.update.mockResolvedValue(true);
  });

  it('persists bearer auth header name and JSON body limit routing settings', async () => {
    await updateSystemConfig(mockRequest as Request, mockResponse as Response);

    expect(mockSystemConfigDao.update).toHaveBeenCalledWith(
      expect.objectContaining({
        routing: expect.objectContaining({
          bearerAuthHeaderName: 'X-MCP-Authorization',
          jsonBodyLimit: '2mb',
        }),
      }),
    );

    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          routing: expect.objectContaining({
            bearerAuthHeaderName: 'X-MCP-Authorization',
            jsonBodyLimit: '2mb',
          }),
        }),
      }),
    );
  });
});

describe('serverController - resetToolDescription', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnThis();

    mockRequest = {
      params: {
        serverName: 'test-server',
        toolName: 'test-server::search',
      },
    };

    mockResponse = {
      json: mockJson,
      status: mockStatus,
    };

    mockServerDao.findById.mockResolvedValue({
      name: 'test-server',
      tools: {
        'test-server::search': {
          enabled: true,
          description: 'Custom description',
        },
      },
    });
    mockServerDao.updateTools.mockResolvedValue(true);
    mockGetServerByName.mockReturnValue({
      tools: [
        {
          name: 'test-server::search',
          description: 'Default description',
        },
      ],
    });
  });

  it('removes the description override and returns the upstream default description', async () => {
    await resetToolDescription(mockRequest as Request, mockResponse as Response);

    expect(mockServerDao.updateTools).toHaveBeenCalledWith('test-server', {});
    expect(mockNotifyToolChanged).toHaveBeenCalled();
    expect(mockSyncToolEmbedding).toHaveBeenCalledWith('test-server', 'test-server::search');
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      message: 'Tool test-server::search description reset successfully',
      data: {
        description: 'Default description',
      },
    });
  });

  it('preserves a disabled tool override while clearing the description override', async () => {
    mockServerDao.findById.mockResolvedValueOnce({
      name: 'test-server',
      tools: {
        'test-server::search': {
          enabled: false,
          description: 'Custom description',
        },
      },
    });

    await resetToolDescription(mockRequest as Request, mockResponse as Response);

    expect(mockServerDao.updateTools).toHaveBeenCalledWith('test-server', {
      'test-server::search': {
        enabled: false,
      },
    });
  });

  it('returns 404 when the server does not exist', async () => {
    mockServerDao.findById.mockResolvedValueOnce(null);

    await resetToolDescription(mockRequest as Request, mockResponse as Response);

    expect(mockStatus).toHaveBeenCalledWith(404);
    expect(mockJson).toHaveBeenCalledWith({
      success: false,
      message: 'Server not found',
    });
  });
});

describe('serverController - resetPromptDescription', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnThis();
    mockRequest = {
      params: {
        serverName: 'test-server',
        promptName: 'test-server::prompt',
      },
    };
    mockResponse = {
      json: mockJson,
      status: mockStatus,
    };

    mockServerDao.findById.mockResolvedValue({
      name: 'test-server',
      prompts: {
        'test-server::prompt': {
          enabled: true,
          description: 'Custom prompt description',
        },
      },
    });
    mockServerDao.updatePrompts.mockResolvedValue(true);
    mockGetServerByName.mockReturnValue({
      prompts: [
        {
          name: 'test-server::prompt',
          description: 'Default prompt description',
        },
      ],
    });
  });

  it('removes the prompt description override and returns the upstream default description', async () => {
    await resetPromptDescription(mockRequest as Request, mockResponse as Response);

    expect(mockServerDao.updatePrompts).toHaveBeenCalledWith('test-server', {});
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      message: 'Prompt test-server::prompt description reset successfully',
      data: {
        description: 'Default prompt description',
      },
    });
  });
});

describe('serverController - resetResourceDescription', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnThis();
    mockRequest = {
      params: {
        serverName: 'test-server',
        resourceUri: 'resource://test',
      },
    };
    mockResponse = {
      json: mockJson,
      status: mockStatus,
    };

    mockServerDao.findById.mockResolvedValue({
      name: 'test-server',
      resources: {
        'resource://test': {
          enabled: true,
          description: 'Custom resource description',
        },
      },
    });
    mockServerDao.updateResources.mockResolvedValue(true);
    mockGetServerByName.mockReturnValue({
      resources: [
        {
          uri: 'resource://test',
          description: 'Default resource description',
        },
      ],
    });
  });

  it('removes the resource description override and returns the upstream default description', async () => {
    await resetResourceDescription(mockRequest as Request, mockResponse as Response);

    expect(mockServerDao.updateResources).toHaveBeenCalledWith('test-server', {});
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      message: 'Resource resource://test description reset successfully',
      data: {
        description: 'Default resource description',
      },
    });
  });
});