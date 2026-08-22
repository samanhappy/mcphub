import express from 'express';
import request from 'supertest';

const mockGetSystemConfig = jest.fn();

jest.mock('../../src/dao/index.js', () => ({
  getSystemConfigDao: jest.fn(() => ({
    get: mockGetSystemConfig,
  })),
  getBearerKeyDao: jest.fn(() => ({
    findEnabled: jest.fn().mockResolvedValue([]),
  })),
  getOAuthTokenDao: jest.fn(() => ({
    findAll: jest.fn().mockResolvedValue([]),
  })),
}));

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getBearerKeyDao: jest.fn(),
  getGroupDao: jest.fn(),
  getOAuthClientDao: jest.fn(),
  getOAuthTokenDao: jest.fn(),
  getServerDao: jest.fn(),
  getSystemConfigDao: jest.fn(),
  getUserConfigDao: jest.fn(),
  getUserDao: jest.fn(),
}));

jest.mock('../../src/services/oauthServerService.js', () => ({
  isOAuthServerEnabled: jest.fn(() => false),
}));

jest.mock('../../src/services/betterAuthConfig.js', () => ({
  getBetterAuthRuntimeConfig: jest.fn().mockResolvedValue({ enabled: false }),
}));

jest.mock('../../src/services/mcpService.js', () => ({
  getServersInfo: jest.fn(),
  addServer: jest.fn(),
  addOrUpdateServer: jest.fn(),
  removeServer: jest.fn(),
  getServerByName: jest.fn(),
  notifyToolChanged: jest.fn(),
  broadcastToolListChanged: jest.fn(),
  broadcastPromptListChanged: jest.fn(),
  broadcastResourceListChanged: jest.fn(),
  syncToolEmbedding: jest.fn(),
  toggleServerStatus: jest.fn(),
  reconnectServer: jest.fn(),
  reinstallServer: jest.fn(),
  updateServerInfoVisibility: jest.fn(),
}));

jest.mock('../../src/services/vectorSearchService.js', () => ({
  removeServerToolEmbeddings: jest.fn(),
  syncAllServerToolsEmbeddings: jest.fn(),
}));

jest.mock('../../src/services/upstreamOAuthDisconnectService.js', () => ({
  disconnectUpstreamOAuth: jest.fn(),
}));

import { auth } from '../../src/middlewares/auth.js';
import { authenticatedRouteRateLimiter } from '../../src/utils/rateLimit.js';
import { updateSystemConfig } from '../../src/controllers/serverController.js';
import { createUserToken } from '../utils/testHelpers.js';

describe('system configuration authorization', () => {
  beforeEach(() => {
    mockGetSystemConfig.mockResolvedValue({
      routing: {
        enableGlobalRoute: true,
        enableGroupNameRoute: true,
        enableBearerAuth: false,
        skipAuth: false,
      },
    });
  });

  it('rejects a non-admin JWT before updating global configuration', async () => {
    const app = express();
    app.use(express.json());
    app.put('/api/system-config', authenticatedRouteRateLimiter, auth, updateSystemConfig);

    const response = await request(app)
      .put('/api/system-config')
      .set('x-auth-token', createUserToken('regular-user', false))
      .send({
        routing: {
          skipAuth: true,
        },
      });

    expect(response.status).toBe(403);
    expect(response.body).toEqual({
      success: false,
      message: 'Admin privileges required',
    });
  });
});
