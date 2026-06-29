import type { Request, Response } from 'express';

const mockGenerateOpenAPISpec = jest.fn();

jest.mock('../../src/services/openApiGeneratorService.js', () => ({
  generateOpenAPISpec: (...args: unknown[]) => mockGenerateOpenAPISpec(...args),
  getAvailableServers: jest.fn(),
  getToolStats: jest.fn(),
}));

jest.mock('../../src/services/mcpService.js', () => ({
  getServerByName: jest.fn(),
}));

jest.mock('../../src/services/groupService.js', () => ({
  getGroupByIdOrName: jest.fn(),
}));

jest.mock('../../src/config/index.js', () => ({
  __esModule: true,
  default: { basePath: '', port: 3000 },
  getNameSeparator: () => '-',
}));

import { getOpenAPISpec } from '../../src/controllers/openApiController.js';

describe('OpenAPI Controller - YAML specs', () => {
  beforeEach(() => {
    mockGenerateOpenAPISpec.mockReset();
  });

  it('serializes the generated root OpenAPI document as YAML for .yaml requests', async () => {
    mockGenerateOpenAPISpec.mockResolvedValue({
      openapi: '3.0.3',
      info: {
        title: 'MCPHub API',
        version: '1.0.0',
      },
      paths: {},
    });

    const req = {
      path: '/api/openapi.yaml',
      query: {},
    } as unknown as Request;
    const res = {
      setHeader: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as Response;

    await getOpenAPISpec(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/yaml');
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('openapi: 3.0.3'));
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('title: MCPHub API'));
    expect(res.json).not.toHaveBeenCalled();
  });

  it('treats uppercase .YAML requests as YAML because Express routing is case-insensitive', async () => {
    mockGenerateOpenAPISpec.mockResolvedValue({
      openapi: '3.0.3',
      info: {
        title: 'MCPHub API',
        version: '1.0.0',
      },
      paths: {},
    });

    const req = {
      path: '/api/openapi.YAML',
      query: {},
    } as unknown as Request;
    const res = {
      setHeader: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as Response;

    await getOpenAPISpec(req, res);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/yaml');
    expect(res.send).toHaveBeenCalledWith(expect.stringContaining('openapi: 3.0.3'));
    expect(res.json).not.toHaveBeenCalled();
  });

  it('does not wrap long markdown descriptions in generated YAML', async () => {
    const longDescription =
      'This markdown description is intentionally longer than eighty characters so it should remain on one YAML line.';

    mockGenerateOpenAPISpec.mockResolvedValue({
      openapi: '3.0.3',
      info: {
        title: 'MCPHub API',
        version: '1.0.0',
        description: longDescription,
      },
      paths: {},
    });

    const req = {
      path: '/api/openapi.yaml',
      query: {},
    } as unknown as Request;
    const res = {
      setHeader: jest.fn(),
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as Response;

    await getOpenAPISpec(req, res);

    expect(res.send).toHaveBeenCalledWith(expect.stringContaining(`description: ${longDescription}`));
    expect(res.send).not.toHaveBeenCalledWith(expect.stringContaining('description: >-'));
  });
});
