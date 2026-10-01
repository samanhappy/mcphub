import type { Request, Response } from 'express';

jest.mock('../../src/services/mcpService.js', () => ({
  handleCallToolRequest: jest.fn(),
  getServerByName: jest.fn(),
}));
jest.mock('../../src/config/index.js', () => ({ getNameSeparator: () => '-' }));

import { callTool } from '../../src/controllers/toolController.js';
import { handleCallToolRequest } from '../../src/services/mcpService.js';

describe('REST tool result forwarding (issue #1250)', () => {
  it.each([
    {
      content: [{ type: 'text', text: 'Found 1 connector' }],
      structuredContent: { connectors: [{ id: 'gmail' }] },
      _meta: { source: 'upstream' },
    },
    { content: [{ type: 'text', text: 'Tool failed' }], isError: true },
    { content: [], isError: false },
    { content: [{ type: 'text', text: 'Legacy result' }] },
    { structuredContent: { value: 42 } },
  ])('preserves upstream result %j in the existing envelope', async (result) => {
    jest.mocked(handleCallToolRequest).mockResolvedValue(result);
    const req = {
      params: { server: 'example' },
      body: { toolName: 'lookup', arguments: { query: 'test' } },
      headers: {},
    } as unknown as Request;
    const res = { json: jest.fn(), status: jest.fn().mockReturnThis() } as unknown as Response;

    await callTool(req, res);

    expect(res.json).toHaveBeenCalledWith({
      success: true,
      data: {
        ...result,
        content: result.content ?? [],
        toolName: 'lookup',
        arguments: { query: 'test' },
      },
    });
    expect(res.status).not.toHaveBeenCalled();
  });
});
