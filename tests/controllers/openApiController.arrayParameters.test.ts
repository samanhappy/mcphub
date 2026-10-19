import type { Request, Response } from 'express';

const mockGetServerByName = jest.fn();
const mockHandleCallToolRequest = jest.fn();

jest.mock('../../src/services/mcpService.js', () => ({
  getServerByName: (...args: unknown[]) => mockGetServerByName(...args),
  handleCallToolRequest: (...args: unknown[]) => mockHandleCallToolRequest(...args),
}));
jest.mock('../../src/services/openApiGeneratorService.js', () => ({}));
jest.mock('../../src/services/groupService.js', () => ({}));
jest.mock('../../src/config/index.js', () => ({ getNameSeparator: () => '-' }));

import { executeToolViaOpenAPI } from '../../src/controllers/openApiController.js';

describe('Dashboard tool array parameters', () => {
  it('converts primitive array form values before forwarding the POST request', async () => {
    mockGetServerByName.mockReturnValue({
      tools: [
        {
          name: 'example-lookup',
          inputSchema: {
            type: 'object',
            properties: {
              ids: { type: 'array', items: { type: 'integer' } },
              weights: { type: 'array', items: { type: 'number' } },
              enabled: { type: 'array', items: { type: 'boolean' } },
            },
          },
        },
      ],
    });
    const result = { content: [{ type: 'text', text: 'ok' }] };
    mockHandleCallToolRequest.mockResolvedValue(result);
    const req = {
      method: 'POST',
      params: { serverName: 'example', toolName: 'lookup' },
      body: { ids: ['1', '2'], weights: ['0', '-2.5'], enabled: ['true', 'false'] },
      headers: {},
    } as unknown as Request;
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() } as unknown as Response;

    await executeToolViaOpenAPI(req, res);

    expect(mockHandleCallToolRequest).toHaveBeenCalledWith(
      {
        params: {
          name: 'example-lookup',
          arguments: { ids: [1, 2], weights: [0, -2.5], enabled: [true, false] },
        },
      },
      { sessionId: 'openapi-session', server: 'example', headers: {} },
    );
    expect(res.json).toHaveBeenCalledWith(result);
    expect(res.status).not.toHaveBeenCalled();
  });
});
