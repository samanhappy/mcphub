/**
 * Tests for RFC 9207 `iss` validation in the upstream OAuth callback:
 * a mismatched issuer must be rejected BEFORE the authorization code is
 * redeemed (mix-up attack mitigation).
 */

jest.mock('../../src/services/mcpService.js', () => ({
  getServerByName: jest.fn(),
  getServerByOAuthState: jest.fn(),
  getServerByPendingOAuthState: jest.fn(),
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

import {
  handleOAuthCallback,
  resetOAuthStateTrackingForTests,
} from '../../src/controllers/oauthCallbackController.js';
import {
  getServerByOAuthState,
  getServerByPendingOAuthState,
  connectClientWithDiagnostics,
  createTransportFromConfig,
  updateServerToolsCache,
} from '../../src/services/mcpService.js';
import { loadServerConfig } from '../../src/services/oauthSettingsStore.js';
import type { ServerInfo } from '../../src/types/index.js';

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

const createServerInfo = (client: MockClient = createMockClient()): ServerInfo => {
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
    resetOAuthStateTrackingForTests();
    serverInfo = createServerInfo();
    originalFinishAuth = serverInfo.transport.finishAuth as jest.Mock;
    (getServerByOAuthState as jest.Mock).mockReturnValue(serverInfo);
    (getServerByPendingOAuthState as jest.Mock).mockReturnValue(undefined);
    (loadServerConfig as jest.Mock).mockResolvedValue({
      url: 'https://upstream.example.com/mcp',
      oauth: {},
    });
    (createTransportFromConfig as jest.Mock).mockResolvedValue({
      finishAuth: jest.fn(),
    });
    // clearAllMocks() keeps implementations, so re-establish the happy-path
    // implementations that later tests may have overridden with mockRejectedValue.
    (connectClientWithDiagnostics as jest.Mock).mockResolvedValue(undefined);
    (updateServerToolsCache as jest.Mock).mockResolvedValue(undefined);
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

  it('rejects a missing iss when the expected issuer is known', async () => {
    const res = createResponse();

    await handleOAuthCallback(
      createRequest({ code: 'auth-code', state: 'state-123' }),
      res as never,
    );

    expect(res.statusCode).toBe(400);
    expect(String(res.body)).toContain('iss parameter is missing');
    expect(originalFinishAuth).not.toHaveBeenCalled();
  });

  it('allows a missing iss when no expected issuer can be established', async () => {
    // No authorizationUrl and no configured issuer: there is nothing to bind
    // the response to, so a legacy server that omits iss is still accepted.
    serverInfo.oauth = { state: 'state-123' };
    serverInfo.config.oauth.pendingAuthorization = {};

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
      createRequest({
        code: 'auth-code',
        state: 'state-123',
        iss: 'https://as.example.com',
      }),
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
      createRequest({
        code: 'auth-code',
        state: 'state-123',
        iss: 'https://as.example.com',
      }),
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
      createRequest({
        code: 'auth-code',
        state: 'state-123',
        iss: 'https://as.example.com',
      }),
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

  it('rejects a forged state that decodes to a server name', async () => {
    // The legacy attack payload: base64url({"server":"upstream-server"}). It
    // must NOT resolve the server — resolution is exact-match against a stored
    // state only (GHSA-vc28-27px-x492).
    const forgedState = Buffer.from(JSON.stringify({ server: 'upstream-server' }))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    (getServerByOAuthState as jest.Mock).mockReturnValueOnce(undefined);

    const res = createResponse();

    await handleOAuthCallback(
      createRequest({ code: 'auth-code', state: forgedState }),
      res as never,
    );

    expect(res.statusCode).toBe(400);
    expect(originalFinishAuth).not.toHaveBeenCalled();
  });

  it('rejects a state that does not match the server in-flight state', async () => {
    // getServerByOAuthState mock returns a server whose stored state is
    // 'state-123'; the supplied state differs, so the callback must be
    // rejected instead of being downgraded to a log warning.
    const res = createResponse();

    await handleOAuthCallback(
      createRequest({ code: 'auth-code', state: 'state-other' }),
      res as never,
    );

    expect(res.statusCode).toBe(400);
    expect(originalFinishAuth).not.toHaveBeenCalled();
  });

  it('rejects an expired state', async () => {
    serverInfo.oauth = { state: 'state-expired', authorizationUrl: AUTHORIZATION_URL };
    serverInfo.config.oauth.pendingAuthorization = {
      state: 'state-expired',
      authorizationUrl: AUTHORIZATION_URL,
      createdAt: Date.now() - 11 * 60 * 1000, // older than the 10-minute TTL
    };

    const res = createResponse();

    await handleOAuthCallback(
      createRequest({ code: 'auth-code', state: 'state-expired', iss: 'https://as.example.com' }),
      res as never,
    );

    expect(res.statusCode).toBe(400);
    expect(originalFinishAuth).not.toHaveBeenCalled();
  });

  it('resolves the server from the persisted pendingAuthorization state', async () => {
    // Restart recovery: the in-memory oauth.state is gone but the persisted
    // pendingAuthorization.state still matches, so the flow proceeds.
    serverInfo.oauth = undefined;
    serverInfo.config.oauth.pendingAuthorization = {
      state: 'state-123',
      authorizationUrl: AUTHORIZATION_URL,
      createdAt: Date.now(),
    };
    (getServerByOAuthState as jest.Mock).mockReturnValueOnce(undefined);
    (getServerByPendingOAuthState as jest.Mock).mockReturnValue(serverInfo);

    const res = createResponse();

    await handleOAuthCallback(
      createRequest({ code: 'auth-code', state: 'state-123', iss: 'https://as.example.com' }),
      res as never,
    );

    expect(res.statusCode).toBe(200);
    expect(originalFinishAuth).toHaveBeenCalledWith('auth-code');
  });

  it('rejects a replayed state after the authorization completed', async () => {
    serverInfo.oauth = { state: 'state-replay', authorizationUrl: AUTHORIZATION_URL };

    const firstResponse = createResponse();
    await handleOAuthCallback(
      createRequest({ code: 'auth-code', state: 'state-replay', iss: 'https://as.example.com' }),
      firstResponse as never,
    );
    expect(firstResponse.statusCode).toBe(200);
    expect(originalFinishAuth).toHaveBeenCalledTimes(1);

    // Replaying the same (now consumed) state must be rejected.
    const replayResponse = createResponse();
    await handleOAuthCallback(
      createRequest({ code: 'auth-code', state: 'state-replay', iss: 'https://as.example.com' }),
      replayResponse as never,
    );
    expect(replayResponse.statusCode).toBe(400);
    expect(originalFinishAuth).toHaveBeenCalledTimes(1);
  });
});
