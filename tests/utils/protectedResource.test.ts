import type { Request } from 'express';
import { getPublicResourceUrl, getResourceMetadataUrl } from '../../src/utils/protectedResource.js';

jest.mock('../../src/config/index.js', () => ({
  __esModule: true,
  default: { basePath: '/internal' },
}));

const originalBaseUrl = process.env.INSTALL_BASE_URL;
afterEach(() => {
  if (originalBaseUrl === undefined) delete process.env.INSTALL_BASE_URL;
  else process.env.INSTALL_BASE_URL = originalBaseUrl;
});

const req = {
  originalUrl: '/internal/mcp/team%20one?session=ignored',
  protocol: 'http',
  headers: {
    host: 'localhost:3000',
    'x-forwarded-host': 'public.example, proxy.internal',
    'x-forwarded-proto': 'https, http',
  },
} as Request;

it('preserves the deployment prefix using forwarded headers without a public URL', () => {
  delete process.env.INSTALL_BASE_URL;
  const resource = getPublicResourceUrl(req);
  expect(resource).toBe('https://public.example/internal/mcp/team%20one');
  expect(getResourceMetadataUrl(resource)).toBe(
    'https://public.example/.well-known/oauth-protected-resource/internal/mcp/team%20one',
  );
});

it('uses the configured environment URL and replaces the internal prefix', () => {
  process.env.INSTALL_BASE_URL = 'https://env.example/external/';
  expect(getPublicResourceUrl(req)).toBe('https://env.example/external/mcp/team%20one');
});

it('prefers stored public settings over the environment and forwarded headers', () => {
  process.env.INSTALL_BASE_URL = 'https://env.example/external';
  expect(getPublicResourceUrl(req, { install: { baseUrl: 'https://settings.example/' } })).toBe(
    'https://settings.example/mcp/team%20one',
  );
});
