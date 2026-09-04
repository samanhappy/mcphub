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
  connectClientWithDiagnostics,
  createTransportFromConfig,
  updateServerToolsCache,
} from '../../src/services/mcpService.js';
import { loadServerConfig } from '../../src/services/oauthSettingsStore.js';

const AUTHORIZATION_URL = 'https://as.example.com/authorize?client_id=mcphub';

type MockClient = {
  close: jest.Mock;
  getServerCapabilities: jest.Mock;
  listTools: jest.Mock;
};

const createMockClient = (): MockClient => ({
  close: jest.fn().mockResolvedValue(undefined),
  getServerCapabilities: jest.fn().mockReturnValue(undefined),
  listTools: jest.fn(),
});

const createServerInfo = (client: MockClient = createMockClient()) => {
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
    client,
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

  it('reconnects a previously initialized client with the refreshed transport', async () => {
    const client: MockClient = {
      close: jest.fn().mockResolvedValue(undefined),
      getServerCapabilities: jest.fn().mockReturnValue({ tools: {} }),
      listTools: jest.fn().mockResolvedValue({
        tools: [{ name: 'refreshed-tool', inputSchema: { type: 'object' } }],
      }),
    };
    serverInfo = createServerInfo(client);
    (getServerByOAuthState as jest.Mock).mockReturnValue(serverInfo);

    const refreshedTransport = { close: jest.fn().mockResolvedValue(undefined) };
    (createTransportFromConfig as jest.Mock).mockResolvedValue(refreshedTransport);
    (connectClientWithDiagnostics as jest.Mock).mockResolvedValue(undefined);

    const res = createResponse();

    await handleOAuthCallback(
      createRequest({ code: 'auth-code', state: 'state-123' }),
      res as never,
    );

    expect(connectClientWithDiagnostics).toHaveBeenCalledWith(
      client,
      refreshedTransport,
      expect.objectContaining({ timeout: 60000 }),
    );
    expect(updateServerToolsCache).toHaveBeenCalledWith(serverInfo, [
      { name: 'refreshed-tool', inputSchema: { type: 'object' } },
    ]);
    expect(serverInfo.status).toBe('connected');
    expect(res.statusCode).toBe(200);
  });

  it('reports a disconnected server when the refreshed transport cannot connect', async () => {
    const client: MockClient = {
      close: jest.fn().mockResolvedValue(undefined),
      getServerCapabilities: jest.fn().mockReturnValue({ tools: {} }),
      listTools: jest.fn(),
    };
    serverInfo = createServerInfo(client);
    (getServerByOAuthState as jest.Mock).mockReturnValue(serverInfo);

    const refreshedTransport = { close: jest.fn().mockResolvedValue(undefined) };
    (createTransportFromConfig as jest.Mock).mockResolvedValue(refreshedTransport);
    const connectionError = new Error('upstream unavailable');
    (connectClientWithDiagnostics as jest.Mock).mockRejectedValue(connectionError);

    const res = createResponse();

    await handleOAuthCallback(
      createRequest({ code: 'auth-code', state: 'state-123' }),
      res as never,
    );

    expect(connectClientWithDiagnostics).toHaveBeenCalledTimes(1);
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(refreshedTransport.close).toHaveBeenCalledTimes(1);
    expect(serverInfo.client).toBeUndefined();
    expect(serverInfo.transport).toBeUndefined();
    expect(serverInfo.status).toBe('disconnected');
    expect(serverInfo.error).toContain('upstream unavailable');
    expect(res.statusCode).toBe(500);
    expect(String(res.body)).toContain('upstream unavailable');
  });

  it('preserves the reconnect error when cleanup also fails', async () => {
    const client: MockClient = {
      close: jest.fn().mockRejectedValue(new Error('client cleanup failed')),
      getServerCapabilities: jest.fn().mockReturnValue({ tools: {} }),
      listTools: jest.fn(),
    };
    serverInfo = createServerInfo(client);
    (getServerByOAuthState as jest.Mock).mockReturnValue(serverInfo);

    const refreshedTransport = {
      close: jest.fn().mockRejectedValue(new Error('transport cleanup failed')),
    };
    (createTransportFromConfig as jest.Mock).mockResolvedValue(refreshedTransport);
    (connectClientWithDiagnostics as jest.Mock).mockRejectedValue(
      new Error('upstream unavailable'),
    );

    const res = createResponse();

    await handleOAuthCallback(
      createRequest({ code: 'auth-code', state: 'state-123' }),
      res as never,
    );

    expect(client.close).toHaveBeenCalledTimes(1);
    expect(refreshedTransport.close).toHaveBeenCalledTimes(1);
    expect(serverInfo.client).toBeUndefined();
    expect(serverInfo.transport).toBeUndefined();
    expect(serverInfo.error).toContain('upstream unavailable');
    expect(serverInfo.error).not.toContain('cleanup failed');
    expect(res.statusCode).toBe(500);
    expect(String(res.body)).toContain('upstream unavailable');
  });
});
