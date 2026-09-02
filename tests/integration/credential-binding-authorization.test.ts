import express from 'express';
import request from 'supertest';

const mockUpsertForPrincipal = jest.fn();
const mockInvalidateCredentialRuntime = jest.fn();

jest.mock('../../src/dao/index.js', () => ({
  getSystemConfigDao: jest.fn(() => ({
    get: jest.fn().mockResolvedValue({ routing: { enableBearerAuth: false, skipAuth: false } }),
  })),
  getBearerKeyDao: jest.fn(() => ({ findEnabled: jest.fn().mockResolvedValue([]) })),
  getOAuthTokenDao: jest.fn(() => ({ findAll: jest.fn().mockResolvedValue([]) })),
}));

jest.mock('../../src/services/oauthServerService.js', () => ({
  isOAuthServerEnabled: jest.fn(() => false),
}));

jest.mock('../../src/services/betterAuthConfig.js', () => ({
  getBetterAuthRuntimeConfig: jest.fn().mockResolvedValue({ enabled: false }),
}));

jest.mock('../../src/services/credentialBindingService.js', () => ({
  CredentialBindingError: class CredentialBindingError extends Error {},
  credentialBindingService: {
    upsertForPrincipal: mockUpsertForPrincipal,
  },
}));

jest.mock('../../src/services/mcpService.js', () => ({
  invalidateCredentialRuntime: mockInvalidateCredentialRuntime,
  refreshCredentialServerCatalog: jest.fn().mockResolvedValue(false),
}));

import { auth } from '../../src/middlewares/auth.js';
import { upsertCredentialBinding } from '../../src/controllers/credentialBindingController.js';
import { createUserToken } from '../utils/testHelpers.js';

describe('credential binding HTTP authorization (#1114)', () => {
  it('uses the email-style JWT principal and ignores a requested alternate owner', async () => {
    mockUpsertForPrincipal.mockResolvedValue({
      serverName: 'personal-server',
      complete: true,
      configured: { env: { TOKEN: true } },
    });
    const app = express();
    app.use(express.json());
    app.put('/api/credentials/:serverName', auth, upsertCredentialBinding);

    const response = await request(app)
      .put('/api/credentials/personal-server')
      .set('x-auth-token', createUserToken('alice@example.com', false))
      .send({ username: 'bob@example.com', values: { env: { TOKEN: 'private-value' } } });

    expect(response.status).toBe(200);
    expect(mockUpsertForPrincipal).toHaveBeenCalledWith(
      'personal-server',
      { username: 'alice@example.com', isAdmin: false },
      { env: { TOKEN: 'private-value' } },
    );
    expect(mockInvalidateCredentialRuntime).toHaveBeenCalledWith(
      'personal-server',
      'alice@example.com',
    );
    expect(JSON.stringify(response.body)).not.toContain('private-value');
  });
});
