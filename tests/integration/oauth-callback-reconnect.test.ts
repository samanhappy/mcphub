import express from 'express';
import rateLimit from 'express-rate-limit';
import request from 'supertest';

jest.mock('../../src/services/mcpService.js', () => ({
  getServerByName: jest.fn(),
  getServerByOAuthState: jest.fn(),
  connectClientWithDiagnostics: jest.fn(),
  createTransportFromConfig: jest.fn(),
  updateServerToolsCache: jest.fn(),
}));

jest.mock('../../src/services/oauthSettingsStore.js', () => ({
  loadServerConfig: jest.fn(),
}));

jest.mock('../../src/config/index.js', () => ({
  replaceEnvVars: jest.fn((value: unknown) => value),
}));

import { handleOAuthCallback } from '../../src/controllers/oauthCallbackController.js';
import {
  connectClientWithDiagnostics,
  createTransportFromConfig,
  getServerByOAuthState,
} from '../../src/services/mcpService.js';
import { loadServerConfig } from '../../src/services/oauthSettingsStore.js';

describe('OAuth callback reconnect integration', () => {
  it('reconnects an existing client after replacing its transport', async () => {
    const serverInfo = {
      name: 'oauth-server',
      status: 'oauth_required' as const,
      config: {
        url: 'https://upstream.example.com/mcp',
        oauth: { dynamicRegistration: { enabled: true } },
      },
      options: undefined,
      transport: {
        finishAuth: jest.fn().mockResolvedValue(undefined),
        close: jest.fn().mockResolvedValue(undefined),
      },
      client: {
        getServerCapabilities: jest.fn().mockReturnValue({ tools: {} }),
        listTools: jest.fn().mockResolvedValue({ tools: [] }),
      },
      tools: [],
      prompts: [],
      resources: [],
      oauth: {
        authorizationUrl: 'https://as.example.com/authorize',
        state: 'state-123',
      },
    };
    const refreshedTransport = { close: jest.fn().mockResolvedValue(undefined) };
    const app = express();
    const limiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
    });
    app.use(limiter);
    app.get('/oauth/callback', (req, res) => {
      void handleOAuthCallback(req, res);
    });

    (getServerByOAuthState as jest.Mock).mockReturnValue(serverInfo);
    (loadServerConfig as jest.Mock).mockResolvedValue(serverInfo.config);
    (createTransportFromConfig as jest.Mock).mockResolvedValue(refreshedTransport);
    (connectClientWithDiagnostics as jest.Mock).mockResolvedValue(undefined);

    const response = await request(app)
      .get('/oauth/callback')
      .query({ code: 'auth-code', state: 'state-123' });

    expect(response.status).toBe(200);
    expect(connectClientWithDiagnostics).toHaveBeenCalledWith(
      serverInfo.client,
      refreshedTransport,
      expect.objectContaining({ timeout: 60000 }),
    );
    expect(serverInfo.status).toBe('connected');
  });
});
