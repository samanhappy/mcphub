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
      const longInvalid = '9'.repeat(4000) + 'x';
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
                longInvalid: { type: 'number' },
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
        longInvalid,
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
        longInvalid,
        ids: [1000, '2.5'],
      });
    },
  );
});

describe('HTTP tool nullable, union and single-item array parameters', () => {
  const inputSchema = {
    type: 'object',
    properties: {
      ids: { type: 'array', items: { type: 'integer' } },
      nullableIds: { type: ['array', 'null'], items: { type: 'integer' } },
      tags: { type: 'array', items: { type: 'string' } },
      limit: { type: ['integer', 'null'] },
      flag: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
      unionIds: { anyOf: [{ type: 'array', items: { type: 'integer' } }, { type: 'null' }] },
      mixed: { anyOf: [{ type: 'integer' }, { type: 'string' }] },
      either: { type: ['integer', 'string'] },
    },
  };

  const forwardedArguments = async (method: 'GET' | 'POST', args: Record<string, unknown>) => {
    mockGetServerByName.mockReturnValue({
      tools: [{ name: 'example-lookup', inputSchema }],
    });
    mockHandleCallToolRequest.mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] });
    const app = express();
    app.use(express.json());
    app.get('/tools/:serverName/:toolName', executeToolViaOpenAPI);
    app.post('/tools/:serverName/:toolName', executeToolViaOpenAPI);

    const response =
      method === 'GET'
        ? await request(app).get('/tools/example/lookup').query(args)
        : await request(app).post('/tools/example/lookup').send(args);

    expect(response.status).toBe(200);
    const calls = mockHandleCallToolRequest.mock.calls;
    return calls[calls.length - 1][0].params.arguments;
  };

  it('converts single query values using the effective schema type', async () => {
    const forwarded = await forwardedArguments('GET', {
      ids: '5',
      nullableIds: '7',
      tags: 'solo',
      limit: '10',
      flag: 'true',
      unionIds: '3',
    });

    expect(forwarded).toEqual({
      ids: [5],
      nullableIds: [7],
      tags: ['solo'],
      limit: 10,
      flag: true,
      unionIds: [3],
    });
  });

  it('converts comma-separated query values using the effective schema type', async () => {
    const forwarded = await forwardedArguments('GET', { nullableIds: '1,2', unionIds: '3, 4' });

    expect(forwarded).toEqual({ nullableIds: [1, 2], unionIds: [3, 4] });
  });

  it('wraps single non-array values from a JSON body when the schema says array', async () => {
    const forwarded = await forwardedArguments('POST', { ids: '5', nullableIds: 7, tags: 'solo' });

    expect(forwarded).toEqual({ ids: [5], nullableIds: [7], tags: ['solo'] });
  });

  it('keeps null for nullable parameters', async () => {
    const forwarded = await forwardedArguments('POST', {
      nullableIds: null,
      limit: null,
      flag: null,
      unionIds: null,
    });

    expect(forwarded).toEqual({ nullableIds: null, limit: null, flag: null, unionIds: null });
  });

  it('leaves values unchanged when the schema allows more than one non-null type', async () => {
    const forwarded = await forwardedArguments('POST', { mixed: '5', either: '5' });

    expect(forwarded).toEqual({ mixed: '5', either: '5' });
  });

  it('keeps arrays that are already arrays', async () => {
    const forwarded = await forwardedArguments('POST', { ids: ['5', '6'], nullableIds: ['7'] });

    expect(forwarded).toEqual({ ids: [5, 6], nullableIds: [7] });
  });
});
