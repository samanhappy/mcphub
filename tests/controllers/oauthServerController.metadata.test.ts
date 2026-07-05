import { Request, Response } from 'express';

const getSystemConfigMock = jest.fn();

jest.mock('../../src/dao/index.js', () => ({
  getSystemConfigDao: jest.fn(() => ({
    get: getSystemConfigMock,
  })),
}));

jest.mock('../../src/services/oauthServerService.js', () => ({
  getOAuthServer: jest.fn(),
  handleTokenRequest: jest.fn(),
  handleAuthenticateRequest: jest.fn(),
}));

jest.mock('../../src/models/OAuth.js', () => ({
  findOAuthClientById: jest.fn(),
}));

jest.mock('../../src/services/betterAuthSession.js', () => ({
  resolveBetterAuthUser: jest.fn(),
}));

import {
  getMetadata,
  getProtectedResourceMetadata,
} from '../../src/controllers/oauthServerController.js';

describe('oauthServerController metadata endpoints', () => {
  const originalEnv = process.env;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.INSTALL_BASE_URL;

    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnThis();

    mockRequest = {
      protocol: 'https',
      get: jest.fn().mockReturnValue('localhost:3000'),
    };
    mockResponse = {
      json: mockJson,
      status: mockStatus,
    };
  });

  it('uses DAO-backed oauthServer and install settings when returning authorization server metadata', async () => {
    getSystemConfigMock.mockResolvedValue({
      install: {
        baseUrl: 'https://mcp.example.com/hub',
      },
      oauthServer: {
        enabled: true,
        requireClientSecret: false,
        allowedScopes: ['read', 'write', 'admin'],
        dynamicRegistration: {
          enabled: true,
        },
      },
    });

    await getMetadata(mockRequest as Request, mockResponse as Response);

    expect(mockJson).toHaveBeenCalledWith({
      issuer: 'https://mcp.example.com/hub',
      authorization_endpoint: 'https://mcp.example.com/hub/oauth/authorize',
      token_endpoint: 'https://mcp.example.com/hub/oauth/token',
      userinfo_endpoint: 'https://mcp.example.com/hub/oauth/userinfo',
      scopes_supported: ['read', 'write', 'admin'],
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256', 'plain'],
      registration_endpoint: 'https://mcp.example.com/hub/oauth/register',
    });
  });

  it('uses INSTALL_BASE_URL when returning authorization server metadata without install.baseUrl', async () => {
    process.env.INSTALL_BASE_URL = 'https://env.example.com/mcphub';
    getSystemConfigMock.mockResolvedValue({
      oauthServer: {
        enabled: true,
        dynamicRegistration: {
          enabled: true,
        },
      },
    });

    await getMetadata(mockRequest as Request, mockResponse as Response);

    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        issuer: 'https://env.example.com/mcphub',
        authorization_endpoint: 'https://env.example.com/mcphub/oauth/authorize',
        token_endpoint: 'https://env.example.com/mcphub/oauth/token',
        registration_endpoint: 'https://env.example.com/mcphub/oauth/register',
      }),
    );
  });

  it('uses DAO-backed baseUrl when returning protected resource metadata', async () => {
    getSystemConfigMock.mockResolvedValue({
      install: {
        baseUrl: 'https://mcp.example.com/hub',
      },
      oauthServer: {
        enabled: true,
        allowedScopes: ['read'],
      },
    });

    await getProtectedResourceMetadata(mockRequest as Request, mockResponse as Response);

    expect(mockJson).toHaveBeenCalledWith({
      resource: 'https://mcp.example.com/hub',
      authorization_servers: ['https://mcp.example.com/hub'],
      scopes_supported: ['read'],
      bearer_methods_supported: ['header'],
    });
  });

  it('uses INSTALL_BASE_URL when returning protected resource metadata without install.baseUrl', async () => {
    process.env.INSTALL_BASE_URL = 'https://env.example.com/mcphub';
    getSystemConfigMock.mockResolvedValue({
      oauthServer: {
        enabled: true,
        allowedScopes: ['read'],
      },
    });

    await getProtectedResourceMetadata(mockRequest as Request, mockResponse as Response);

    expect(mockJson).toHaveBeenCalledWith({
      resource: 'https://env.example.com/mcphub',
      authorization_servers: ['https://env.example.com/mcphub'],
      scopes_supported: ['read'],
      bearer_methods_supported: ['header'],
    });
  });

  it('returns default metadata when oauthServer is an empty object (first DB-mode startup)', async () => {
    getSystemConfigMock.mockResolvedValue({
      oauthServer: {},
    });

    await getMetadata(mockRequest as Request, mockResponse as Response);

    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization_endpoint: 'https://localhost:3000/oauth/authorize',
        token_endpoint: 'https://localhost:3000/oauth/token',
        scopes_supported: ['read', 'write'],
        code_challenge_methods_supported: ['S256', 'plain'],
      }),
    );
  });

  it('returns default metadata when oauthServer is undefined', async () => {
    getSystemConfigMock.mockResolvedValue({});

    await getMetadata(mockRequest as Request, mockResponse as Response);

    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization_endpoint: 'https://localhost:3000/oauth/authorize',
        token_endpoint: 'https://localhost:3000/oauth/token',
        scopes_supported: ['read', 'write'],
      }),
    );
  });

  it('returns default protected resource metadata when oauthServer is an empty object', async () => {
    getSystemConfigMock.mockResolvedValue({
      oauthServer: {},
    });

    await getProtectedResourceMetadata(mockRequest as Request, mockResponse as Response);

    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization_servers: ['https://localhost:3000'],
        scopes_supported: ['read', 'write'],
        bearer_methods_supported: ['header'],
      }),
    );
  });

  it('returns default protected resource metadata when oauthServer is undefined', async () => {
    getSystemConfigMock.mockResolvedValue({});

    await getProtectedResourceMetadata(mockRequest as Request, mockResponse as Response);

    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        authorization_servers: ['https://localhost:3000'],
        scopes_supported: ['read', 'write'],
      }),
    );
  });

  it('returns 404 when oauthServer.enabled is explicitly false', async () => {
    getSystemConfigMock.mockResolvedValue({
      oauthServer: { enabled: false },
    });

    await getMetadata(mockRequest as Request, mockResponse as Response);

    expect(mockStatus).toHaveBeenCalledWith(404);
    expect(mockJson).toHaveBeenCalledWith({ error: 'OAuth server not configured' });
  });

  it('returns 404 for protected resource when oauthServer.enabled is explicitly false', async () => {
    getSystemConfigMock.mockResolvedValue({
      oauthServer: { enabled: false },
    });

    await getProtectedResourceMetadata(mockRequest as Request, mockResponse as Response);

    expect(mockStatus).toHaveBeenCalledWith(404);
    expect(mockJson).toHaveBeenCalledWith({ error: 'OAuth server not configured' });
  });

  it('merges partial config with defaults so missing fields inherit default values', async () => {
    getSystemConfigMock.mockResolvedValue({
      oauthServer: { enabled: true },
    });

    await getMetadata(mockRequest as Request, mockResponse as Response);

    expect(mockStatus).not.toHaveBeenCalled();
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        scopes_supported: ['read', 'write'],
        code_challenge_methods_supported: ['S256', 'plain'],
        token_endpoint_auth_methods_supported: ['none'],
      }),
    );
  });

  afterAll(() => {
    process.env = originalEnv;
  });
});
