import { Request, Response } from 'express';
import { jest } from '@jest/globals';

const getOAuthClientsMock = jest.fn();
const findOAuthClientByIdMock = jest.fn();
const createOAuthClientMock = jest.fn();
const updateOAuthClientMock = jest.fn();
const deleteOAuthClientMock = jest.fn();

jest.mock('../../src/models/OAuth.js', () => ({
  getOAuthClients: getOAuthClientsMock,
  findOAuthClientById: findOAuthClientByIdMock,
  createOAuthClient: createOAuthClientMock,
  updateOAuthClient: updateOAuthClientMock,
  deleteOAuthClient: deleteOAuthClientMock,
}));

import {
  getAllClients,
  getClient,
  updateClient,
  deleteClient,
  regenerateSecret,
} from '../../src/controllers/oauthClientController.js';

const createResponse = () => {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return {
    json,
    status,
    response: {
      json,
      status,
    } as unknown as Response,
  };
};

describe('oauthClientController authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('filters client lists to the authenticated owner', async () => {
    getOAuthClientsMock.mockResolvedValue([
      { clientId: 'a', name: 'A', redirectUris: [], grants: [], scopes: [], owner: 'alice' },
      { clientId: 'b', name: 'B', redirectUris: [], grants: [], scopes: [], owner: 'bob' },
    ]);

    const { json, response } = createResponse();
    const req = {
      user: { username: 'alice', isAdmin: false },
    } as unknown as Request;

    await getAllClients(req, response);

    expect(json).toHaveBeenCalledWith({
      success: true,
      clients: [
        {
          clientId: 'a',
          name: 'A',
          redirectUris: [],
          grants: [],
          scopes: [],
          owner: 'alice',
        },
      ],
    });
  });

  it('rejects reading another user client', async () => {
    findOAuthClientByIdMock.mockResolvedValue({
      clientId: 'b',
      name: 'B',
      redirectUris: [],
      grants: [],
      scopes: [],
      owner: 'bob',
    });

    const { json, status, response } = createResponse();
    const req = {
      params: { clientId: 'b' },
      user: { username: 'alice', isAdmin: false },
    } as unknown as Request;

    await getClient(req, response);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ success: false, message: 'Forbidden' });
  });

  it('rejects updating another user client', async () => {
    findOAuthClientByIdMock.mockResolvedValue({
      clientId: 'b',
      name: 'B',
      redirectUris: [],
      grants: [],
      scopes: [],
      owner: 'bob',
    });

    const { json, status, response } = createResponse();
    const req = {
      params: { clientId: 'b' },
      body: { name: 'Updated' },
      user: { username: 'alice', isAdmin: false },
    } as unknown as Request;

    await updateClient(req, response);

    expect(updateOAuthClientMock).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ success: false, message: 'Forbidden' });
  });

  it('rejects deleting another user client', async () => {
    findOAuthClientByIdMock.mockResolvedValue({
      clientId: 'b',
      name: 'B',
      redirectUris: [],
      grants: [],
      scopes: [],
      owner: 'bob',
    });

    const { json, status, response } = createResponse();
    const req = {
      params: { clientId: 'b' },
      user: { username: 'alice', isAdmin: false },
    } as unknown as Request;

    await deleteClient(req, response);

    expect(deleteOAuthClientMock).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ success: false, message: 'Forbidden' });
  });

  it('rejects regenerating another user secret', async () => {
    findOAuthClientByIdMock.mockResolvedValue({
      clientId: 'b',
      name: 'B',
      redirectUris: [],
      grants: [],
      scopes: [],
      owner: 'bob',
    });

    const { json, status, response } = createResponse();
    const req = {
      params: { clientId: 'b' },
      user: { username: 'alice', isAdmin: false },
    } as unknown as Request;

    await regenerateSecret(req, response);

    expect(updateOAuthClientMock).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ success: false, message: 'Forbidden' });
  });
});
