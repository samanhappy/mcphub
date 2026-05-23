import { Request, Response } from 'express';

const getSystemConfigMock = jest.fn();
const createOAuthClientMock = jest.fn();
const findOAuthClientByIdMock = jest.fn();
const updateOAuthClientMock = jest.fn();
const deleteOAuthClientMock = jest.fn();

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getSystemConfigDao: jest.fn(() => ({
    get: getSystemConfigMock,
  })),
}));

jest.mock('../../src/models/OAuth.js', () => ({
  createOAuthClient: createOAuthClientMock,
  findOAuthClientById: findOAuthClientByIdMock,
  updateOAuthClient: updateOAuthClientMock,
  deleteOAuthClient: deleteOAuthClientMock,
}));

import { registerClient } from '../../src/controllers/oauthDynamicRegistrationController.js';

describe('oauthDynamicRegistrationController - registerClient', () => {
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockJson: jest.Mock;
  let mockStatus: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();

    mockJson = jest.fn();
    mockStatus = jest.fn().mockReturnThis();

    mockRequest = {
      protocol: 'https',
      get: jest.fn().mockReturnValue('localhost:3000'),
      body: {
        redirect_uris: ['https://client.example.com/callback'],
        client_name: 'Test Dynamic Client',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'read write',
      },
    };

    mockResponse = {
      json: mockJson,
      status: mockStatus,
    };

    getSystemConfigMock.mockResolvedValue({
      install: {
        baseUrl: 'https://mcp.example.com/hub',
      },
      oauthServer: {
        enabled: true,
        allowedScopes: ['read', 'write'],
        dynamicRegistration: {
          enabled: true,
          allowedGrantTypes: ['authorization_code', 'refresh_token'],
        },
      },
    });

    createOAuthClientMock.mockImplementation(async (client) => client);
  });

  it('uses DAO-backed oauthServer and install settings when registering clients', async () => {
    await registerClient(mockRequest as Request, mockResponse as Response);

    expect(createOAuthClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Test Dynamic Client',
        redirectUris: ['https://client.example.com/callback'],
        grants: ['authorization_code', 'refresh_token'],
        scopes: ['read', 'write'],
      }),
    );

    expect(mockStatus).toHaveBeenCalledWith(201);
    expect(mockJson).toHaveBeenCalledWith(
      expect.objectContaining({
        client_name: 'Test Dynamic Client',
        redirect_uris: ['https://client.example.com/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        scope: 'read write',
        registration_client_uri: expect.stringMatching(
          /^https:\/\/mcp\.example\.com\/hub\/oauth\/register\/[0-9a-f]+$/,
        ),
      }),
    );
  });
});
