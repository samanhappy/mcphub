import type { Request, Response } from 'express';

const mockListForPrincipal = jest.fn();
const mockUpsertForPrincipal = jest.fn();
const mockDeleteForPrincipal = jest.fn();
const mockInvalidateCredentialRuntime = jest.fn();
const mockRefreshCredentialServerCatalog = jest.fn().mockResolvedValue(false);

jest.mock('../../src/services/credentialBindingService.js', () => ({
  credentialBindingService: {
    listForPrincipal: mockListForPrincipal,
    upsertForPrincipal: mockUpsertForPrincipal,
    deleteForPrincipal: mockDeleteForPrincipal,
  },
  CredentialBindingAccessError: class CredentialBindingAccessError extends Error {},
  CredentialBindingValidationError: class CredentialBindingValidationError extends Error {},
}));

jest.mock('../../src/services/mcpService.js', () => ({
  invalidateCredentialRuntime: mockInvalidateCredentialRuntime,
  refreshCredentialServerCatalog: mockRefreshCredentialServerCatalog,
}));

import {
  deleteCredentialBinding,
  getCredentialBindings,
  upsertCredentialBinding,
} from '../../src/controllers/credentialBindingController.js';

const makeReq = (overrides: Record<string, unknown> = {}) =>
  ({
    params: {},
    body: {},
    user: { username: 'alice@example.com', isAdmin: false },
    ...overrides,
  }) as unknown as Request;

const makeRes = () => {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  return res as unknown as Response;
};

describe('credentialBindingController (#1114)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns current-user binding metadata without serialized credential values', async () => {
    mockListForPrincipal.mockResolvedValue([
      {
        serverName: 'tavily',
        complete: true,
        configured: { env: { TAVILY_API_KEY: true } },
      },
    ]);
    const res = makeRes();

    await getCredentialBindings(makeReq(), res);

    expect(mockListForPrincipal).toHaveBeenCalledWith({
      username: 'alice@example.com',
      isAdmin: false,
    });
    const serialized = JSON.stringify((res.json as jest.Mock).mock.calls[0][0]);
    expect(serialized).not.toContain('secret');
    expect(serialized).not.toContain('encryptedValues');
  });

  it('ignores any supplied username and writes only for the authenticated principal', async () => {
    mockUpsertForPrincipal.mockResolvedValue({
      serverName: 'tavily',
      complete: true,
      configured: { env: { TAVILY_API_KEY: true } },
    });
    const values = { env: { TAVILY_API_KEY: 'alice-controller-secret' } };
    const res = makeRes();

    await upsertCredentialBinding(
      makeReq({
        params: { serverName: 'tavily' },
        body: { username: 'bob', values },
      }),
      res,
    );

    expect(mockUpsertForPrincipal).toHaveBeenCalledWith(
      'tavily',
      { username: 'alice@example.com', isAdmin: false },
      values,
    );
    expect(mockInvalidateCredentialRuntime).toHaveBeenCalledWith(
      'tavily',
      'alice@example.com',
    );
    expect(JSON.stringify((res.json as jest.Mock).mock.calls[0][0])).not.toContain(
      'alice-controller-secret',
    );
  });

  it('invalidates only the current principal runtime after deletion', async () => {
    mockDeleteForPrincipal.mockResolvedValue(true);
    const res = makeRes();

    await deleteCredentialBinding(
      makeReq({ params: { serverName: 'tavily', username: 'bob' } }),
      res,
    );

    expect(mockDeleteForPrincipal).toHaveBeenCalledWith('tavily', {
      username: 'alice@example.com',
      isAdmin: false,
    });
    expect(mockInvalidateCredentialRuntime).toHaveBeenCalledWith(
      'tavily',
      'alice@example.com',
    );
  });
});
