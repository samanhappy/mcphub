import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { Request, Response } from 'express';
import { JWT_SECRET } from '../../src/config/jwt.js';

const getSystemConfigMock = jest.fn();
const findByUsernameMock = jest.fn();
const countMock = jest.fn();
const resolveOAuthUserFromHeadersMock = jest.fn();
const getBearerTokenFromHeadersMock = jest.fn();

jest.mock('../../src/dao/index.js', () => ({
  getSystemConfigDao: () => ({
    get: getSystemConfigMock,
  }),
  getUserDao: () => ({
    findByUsername: findByUsernameMock,
    count: countMock,
  }),
}));

jest.mock('../../src/utils/oauthBearer.js', () => ({
  resolveOAuthUserFromHeaders: resolveOAuthUserFromHeadersMock,
}));

jest.mock('../../src/utils/bearerAuth.js', () => ({
  getBearerTokenFromHeaders: getBearerTokenFromHeadersMock,
}));

import { sseUserContextMiddleware } from '../../src/middlewares/userContext.js';

const createResponse = () => {
  const status = jest.fn().mockReturnThis();
  const json = jest.fn();

  return {
    status,
    json,
    response: {
      status,
      json,
    } as unknown as Response,
  };
};

const waitForAsyncMiddleware = async () => {
  await new Promise((resolve) => setImmediate(resolve));
};

describe('sseUserContextMiddleware', () => {
  beforeEach(() => {
    getSystemConfigMock.mockResolvedValue({});
    findByUsernameMock.mockReset();
    countMock.mockReset();
    resolveOAuthUserFromHeadersMock.mockResolvedValue(null);
    getBearerTokenFromHeadersMock.mockReturnValue(undefined);
  });

  it('rejects user-scoped SSE requests when JWT user is not found in persistence', async () => {
    const token = jwt.sign({ user: { username: 'ghost', isAdmin: false } }, JWT_SECRET);
    findByUsernameMock.mockResolvedValue(null);
    countMock.mockResolvedValue(2); // users ARE configured
    const { response, status, json } = createResponse();
    const next = jest.fn();
    const req = {
      params: { user: 'ghost' },
      header: (name: string) => (name === 'x-auth-token' ? token : undefined),
      query: {},
      headers: {},
    } as unknown as Request;

    await sseUserContextMiddleware(req, response, next);
    await waitForAsyncMiddleware();

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'Authentication is required for user-scoped SSE routes',
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('allows user-scoped SSE requests when JWT user exists and matches the route user', async () => {
    const token = jwt.sign({ user: { username: 'alice', isAdmin: false } }, JWT_SECRET);
    findByUsernameMock.mockResolvedValue({ username: 'alice', password: 'hashed', isAdmin: false });
    const { response, status } = createResponse();
    const next = jest.fn();
    const req = {
      params: { user: 'alice' },
      header: (name: string) => (name === 'x-auth-token' ? token : undefined),
      query: {},
      headers: {},
    } as unknown as Request;

    await sseUserContextMiddleware(req, response, next);
    await waitForAsyncMiddleware();

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it('rejects user-scoped SSE requests when authenticated user does not match route user', async () => {
    const token = jwt.sign({ user: { username: 'alice', isAdmin: false } }, JWT_SECRET);
    findByUsernameMock.mockResolvedValue({ username: 'alice', password: 'hashed', isAdmin: false });
    const { response, status, json } = createResponse();
    const next = jest.fn();
    const req = {
      params: { user: 'bob' },
      header: (name: string) => (name === 'x-auth-token' ? token : undefined),
      query: {},
      headers: {},
    } as unknown as Request;

    await sseUserContextMiddleware(req, response, next);
    await waitForAsyncMiddleware();

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        message: 'User-scoped SSE routes may only be accessed by the matching user',
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('allows user-scoped SSE requests when no users are configured (no user management)', async () => {
    // Simulates deployments with smart routing disabled or fresh installs —
    // no users in storage means user-scoped JWT claims are trusted as-is.
    const token = jwt.sign({ user: { username: 'alice', isAdmin: false } }, JWT_SECRET);
    findByUsernameMock.mockResolvedValue(null);
    countMock.mockResolvedValue(0); // no users in system
    const { response, status } = createResponse();
    const next = jest.fn();
    const req = {
      params: { user: 'alice' },
      header: (name: string) => (name === 'x-auth-token' ? token : undefined),
      query: {},
      headers: {},
    } as unknown as Request;

    await sseUserContextMiddleware(req, response, next);
    await waitForAsyncMiddleware();

    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });
});
