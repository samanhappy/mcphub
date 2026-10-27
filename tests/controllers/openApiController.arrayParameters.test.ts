import express, { type Request, type Response } from 'express';
import request from 'supertest';

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
import { callTool } from '../../src/controllers/toolController.js';

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

describe('HTTP tool numeric parameters', () => {
  it.each(['GET', 'POST', 'dashboard'])(
    'forwards complete numeric values without truncation through %s',
    async (method) => {
      mockGetServerByName.mockReturnValue({
        tools: [
          {
            name: 'example-lookup',
            inputSchema: {
              type: 'object',
              properties: {
                limit: { type: 'integer' },
                ratio: { type: 'number' },
                fractional: { type: 'integer' },
                trailing: { type: 'number' },
                empty: { type: 'number' },
                whitespace: { type: 'number' },
                infinite: { type: 'number' },
                overflow: { type: 'number' },
                hex: { type: 'number' },
                ids: { type: 'array', items: { type: 'integer' } },
              },
            },
          },
        ],
      });
      mockHandleCallToolRequest.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
      const args = {
        limit: '1e3',
        ratio: '2.5e-2',
        fractional: '1.5',
        trailing: '12oops',
        empty: '',
        whitespace: '   ',
        infinite: 'Infinity',
        overflow: '1e400',
        hex: '0x10',
        ids: method === 'GET' ? '1e3,2.5' : ['1e3', '2.5'],
      };
      const app = express();
      app.use(express.json());
      app.get('/tools/:serverName/:toolName', executeToolViaOpenAPI);
      app.post('/tools/:serverName/:toolName', executeToolViaOpenAPI);
      app.post('/dashboard/:server', callTool);

      const response =
        method === 'GET'
          ? await request(app).get('/tools/example/lookup').query(args)
          : method === 'POST'
            ? await request(app).post('/tools/example/lookup').send(args)
            : await request(app)
                .post('/dashboard/example')
                .send({ toolName: 'lookup', arguments: args });

      expect(response.status).toBe(200);
      expect(mockHandleCallToolRequest).toHaveBeenCalledTimes(1);
      const forwarded = mockHandleCallToolRequest.mock.calls[0][0].params.arguments;
      expect(method === 'dashboard' ? forwarded.arguments : forwarded).toEqual({
        limit: 1000,
        ratio: 0.025,
        fractional: '1.5',
        trailing: '12oops',
        empty: '',
        whitespace: '   ',
        infinite: 'Infinity',
        overflow: '1e400',
        hex: '0x10',
        ids: [1000, '2.5'],
      });
    },
  );
});
