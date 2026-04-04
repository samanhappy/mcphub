import { jest } from '@jest/globals';

const mockJsonMiddleware = jest.fn((_req, _res, next) => next());
const mockExpressJson = jest.fn(() => mockJsonMiddleware);

let currentSettings = {
  systemConfig: {
    routing: {
      jsonBodyLimit: '1mb',
    },
  },
};

jest.mock('express', () => {
  const expressMock = Object.assign(jest.fn(), {
    json: mockExpressJson,
  });

  return {
    __esModule: true,
    default: expressMock,
  };
});

jest.mock('../config/index.js', () => ({
  __esModule: true,
  default: {
    basePath: '/test',
  },
}));

jest.mock('../dao/index.js', () => ({
  getSystemConfigDao: jest.fn(() => ({
    get: jest.fn().mockImplementation(async () => currentSettings.systemConfig),
  })),
}));

jest.mock('./auth.js', () => ({
  auth: jest.fn((_req, _res, next) => next()),
}));

jest.mock('./userContext.js', () => ({
  userContextMiddleware: jest.fn((_req, _res, next) => next()),
}));

jest.mock('./i18n.js', () => ({
  i18nMiddleware: jest.fn((_req, _res, next) => next()),
}));

jest.mock('../services/betterAuthConfig.js', () => ({
  getBetterAuthRuntimeConfig: jest.fn(() => ({
    basePath: '/better-auth',
  })),
}));

import { initMiddlewares } from './index.js';

describe('initMiddlewares', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    currentSettings = {
      systemConfig: {
        routing: {
          jsonBodyLimit: '1mb',
        },
      },
    };
  });

  it('uses the configured JSON body limit for API requests', async () => {
    currentSettings.systemConfig.routing.jsonBodyLimit = '2mb';

    const app = {
      use: jest.fn(),
    } as any;

    initMiddlewares(app);

    const jsonWrapper = app.use.mock.calls[1][0];
    const next = jest.fn();

    await jsonWrapper(
      {
        path: '/test/api/servers',
      },
      {},
      next,
    );

    expect(mockExpressJson).toHaveBeenCalledWith({ limit: '2mb' });
    expect(mockJsonMiddleware).toHaveBeenCalled();
  });

  it('defaults the JSON body limit to 1mb when unset', async () => {
    currentSettings = {
      systemConfig: {
        routing: {},
      },
    };

    const app = {
      use: jest.fn(),
    } as any;

    initMiddlewares(app);

    const jsonWrapper = app.use.mock.calls[1][0];
    const next = jest.fn();

    await jsonWrapper(
      {
        path: '/test/api/servers',
      },
      {},
      next,
    );

    expect(mockExpressJson).toHaveBeenCalledWith({ limit: '1mb' });
    expect(mockJsonMiddleware).toHaveBeenCalled();
  });
});