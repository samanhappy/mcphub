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
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

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
});
