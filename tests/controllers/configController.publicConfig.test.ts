import { Request, Response } from 'express';

const getSystemConfigMock = jest.fn();
const getPermissionsMock = jest.fn();
const getBetterAuthRuntimeConfigMock = jest.fn();
const getAppliedBetterAuthRuntimeConfigMock = jest.fn();
const resolveBetterAuthRuntimeConfigMock = jest.fn();
const isBetterAuthRestartRequiredMock = jest.fn();

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getSystemConfigDao: jest.fn(() => ({
    get: getSystemConfigMock,
  })),
}));

jest.mock('../../src/services/services.js', () => ({
  getDataService: jest.fn(() => ({
    getPermissions: getPermissionsMock,
  })),
}));

jest.mock('../../src/services/betterAuthConfig.js', () => ({
  getAppliedBetterAuthRuntimeConfig: getAppliedBetterAuthRuntimeConfigMock,
  getBetterAuthRuntimeConfig: getBetterAuthRuntimeConfigMock,
  isBetterAuthRestartRequired: isBetterAuthRestartRequiredMock,
  resolveBetterAuthRuntimeConfig: resolveBetterAuthRuntimeConfigMock,
  toBetterAuthPublicConfig: (config: unknown) => config,
}));

import { getBetterAuthStatus, getPublicConfig } from '../../src/controllers/configController.js';

describe('ConfigController - getPublicConfig', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockJson = jest.fn();
    mockRequest = {};
    mockResponse = {
      json: mockJson,
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
    };
  });

  it('uses DAO-backed routing and Better Auth configuration for public config', async () => {
    const systemConfig = {
      routing: {
        skipAuth: true,
      },
      auth: {
        betterAuth: {
          enabled: true,
        },
      },
    };

    getSystemConfigMock.mockResolvedValue(systemConfig);
    getPermissionsMock.mockReturnValue({
      settings: ['manage'],
    });
    getAppliedBetterAuthRuntimeConfigMock.mockReturnValue({
      enabled: true,
      basePath: '/api/auth/better',
      trustedOrigins: ['https://mcp.example.com'],
      allowLocalUser: true,
      autoLogin: true,
      providers: {
        google: { enabled: false },
        github: { enabled: false },
        oidc: {
          enabled: true,
          configViaUi: true,
          providerId: 'oidc',
          discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
          clientId: 'mcphub',
          clientConfigured: true,
          scopes: ['openid', 'profile', 'email'],
          pkce: true,
          prompt: undefined,
        },
      },
    });

    await getPublicConfig(mockRequest as Request, mockResponse as Response);

    expect(getSystemConfigMock).toHaveBeenCalledTimes(1);
    expect(getAppliedBetterAuthRuntimeConfigMock).toHaveBeenCalledTimes(1);
    expect(getPermissionsMock).toHaveBeenCalledWith({
      username: 'guest',
      password: '',
      isAdmin: true,
    });
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      data: {
        skipAuth: true,
        permissions: {
          settings: ['manage'],
        },
        betterAuth: {
          enabled: true,
          basePath: '/api/auth/better',
          trustedOrigins: ['https://mcp.example.com'],
          allowLocalUser: true,
          autoLogin: true,
          providers: {
            google: { enabled: false },
            github: { enabled: false },
            oidc: {
              enabled: true,
              configViaUi: true,
              providerId: 'oidc',
              discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
              clientId: 'mcphub',
              clientConfigured: true,
              scopes: ['openid', 'profile', 'email'],
              pkce: true,
              prompt: undefined,
            },
          },
        },
      },
    });
  });

  it('does not request guest permissions when skipAuth is disabled in DAO-backed settings', async () => {
    const systemConfig = {
      routing: {
        skipAuth: false,
      },
    };

    getSystemConfigMock.mockResolvedValue(systemConfig);
    getAppliedBetterAuthRuntimeConfigMock.mockReturnValue({
      enabled: false,
      basePath: '/api/auth/better',
      trustedOrigins: [],
      allowLocalUser: true,
      autoLogin: true,
      providers: {
        google: { enabled: false },
        github: { enabled: false },
        oidc: {
          enabled: false,
          configViaUi: false,
          providerId: 'oidc',
          discoveryUrl: undefined,
          clientId: undefined,
          clientConfigured: false,
          scopes: ['openid', 'profile', 'email'],
          pkce: true,
          prompt: undefined,
        },
      },
    });

    await getPublicConfig(mockRequest as Request, mockResponse as Response);

    expect(getPermissionsMock).not.toHaveBeenCalled();
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        data: expect.objectContaining({
          skipAuth: false,
          permissions: {},
        }),
      }),
    );
  });

  it('returns desired and applied Better Auth status for admins', async () => {
    const systemConfig = {
      auth: {
        betterAuth: {
          enabled: true,
        },
      },
    };
    const desiredConfig = {
      enabled: true,
      basePath: '/api/auth/better',
      trustedOrigins: ['https://mcp.example.com'],
      allowLocalUser: true,
      autoLogin: true,
      providers: {
        google: { enabled: false },
        github: { enabled: false },
        oidc: {
          enabled: true,
          configViaUi: true,
          providerId: 'authentik',
          discoveryUrl: 'https://auth.example.com/.well-known/openid-configuration',
          clientId: 'mcphub',
          clientConfigured: true,
          scopes: ['openid', 'profile', 'email'],
          pkce: false,
          prompt: undefined,
        },
      },
    };
    const appliedConfig = {
      ...desiredConfig,
      providers: {
        ...desiredConfig.providers,
        oidc: {
          ...desiredConfig.providers.oidc,
          enabled: false,
        },
      },
    };

    mockRequest = {
      user: {
        username: 'admin',
        isAdmin: true,
      },
    };
    getSystemConfigMock.mockResolvedValue(systemConfig);
    getBetterAuthRuntimeConfigMock.mockResolvedValue(desiredConfig);
    getAppliedBetterAuthRuntimeConfigMock.mockReturnValue(appliedConfig);
    isBetterAuthRestartRequiredMock.mockReturnValue(true);

    await getBetterAuthStatus(mockRequest as Request, mockResponse as Response);

    expect(getBetterAuthRuntimeConfigMock).toHaveBeenCalledWith(systemConfig);
    expect(mockJson).toHaveBeenCalledWith({
      success: true,
      data: {
        desired: desiredConfig,
        applied: appliedConfig,
        restartRequired: true,
      },
    });
  });
});
