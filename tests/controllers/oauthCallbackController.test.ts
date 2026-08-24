/**
 * Tests for RFC 9207 `iss` validation in the upstream OAuth callback:
 * a mismatched issuer must be rejected BEFORE the authorization code is
 * redeemed (mix-up attack mitigation).
 */

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
  getServerByOAuthState,
  createTransportFromConfig,
} from '../../src/services/mcpService.js';
import { loadServerConfig } from '../../src/services/oauthSettingsStore.js';

const AUTHORIZATION_URL = 'https://as.example.com/authorize?client_id=mcphub';

const createServerInfo = () => {
  const finishAuth = jest.fn().mockResolvedValue(undefined);
  return {
    name: 'upstream-server',
    status: 'oauth_required',
    config: {
      url: 'https://upstream.example.com/mcp',
      oauth: { dynamicRegistration: { enabled: true } },
    },
    options: undefined,
    transport: { finishAuth, close: jest.fn().mockResolvedValue(undefined) },
    client: undefined,
    tools: [],
    oauth: {
      authorizationUrl: AUTHORIZATION_URL,
      state: 'state-123',
    },
  };
};

const createRequest = (query: Record<string, string>) =>
  ({
    query,
    t: (key: string) => key,
    protocol: 'http',
    get: jest.fn().mockReturnValue('localhost:3000'),
  }) as unknown as import('express').Request;

const createResponse = () => {
  const res = {
    statusCode: 200,
    body: '',
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(html: string) {
      this.body = html;
      return this;
    },
  };
  return res;
};

describe('oauthCallbackController iss validation', () => {
  let serverInfo: ReturnType<typeof createServerInfo>;
  let originalFinishAuth: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    serverInfo = createServerInfo();
    originalFinishAuth = serverInfo.transport.finishAuth as jest.Mock;
    (getServerByOAuthState as jest.Mock).mockReturnValue(serverInfo);
    (loadServerConfig as jest.Mock).mockResolvedValue({
      url: 'https://upstream.example.com/mcp',
      oauth: {},
    });
    (createTransportFromConfig as jest.Mock).mockResolvedValue({
      finishAuth: jest.fn(),
    });
  });

  it('redeems the code when iss matches the authorization server origin', async () => {
    const res = createResponse();

    await handleOAuthCallback(
      createRequest({ code: 'auth-code', state: 'state-123', iss: 'https://as.example.com' }),
      res as never,
    );

    expect(res.statusCode).toBe(200);
    expect(originalFinishAuth).toHaveBeenCalledWith('auth-code');
  });

  it('rejects a mismatched iss without redeeming the code', async () => {
    const res = createResponse();

    await handleOAuthCallback(
      createRequest({ code: 'auth-code', state: 'state-123', iss: 'https://evil.example.com' }),
      res as never,
    );

    expect(res.statusCode).toBe(400);
    expect(String(res.body)).toContain('iss parameter does not match');
    expect(serverInfo.oauth?.state).toBe('state-123');
    expect(originalFinishAuth).not.toHaveBeenCalled();
  });

  it('allows legacy servers that omit iss entirely', async () => {
    const res = createResponse();

    await handleOAuthCallback(
      createRequest({ code: 'auth-code', state: 'state-123' }),
      res as never,
    );

    expect(res.statusCode).toBe(200);
    expect(originalFinishAuth).toHaveBeenCalledWith('auth-code');
  });
});
