import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MarketServerDetail from '../../frontend/src/components/MarketServerDetail';
import RegistryServerDetail from '../../frontend/src/components/RegistryServerDetail';
import type { MarketServer, RegistryServerEntry } from '../../frontend/src/types';

let mockIsAdmin = false;
jest.mock('../../frontend/src/contexts/AuthContext', () => ({
  useAuth: () => ({ auth: { user: { isAdmin: mockIsAdmin } } }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../../frontend/src/components/ServerForm', () => () => null);

const localServer = {
  name: 'example',
  display_name: 'Example',
  repository: { type: 'git', url: 'https://example.com' },
  installations: { npm: { type: 'stdio', command: 'npx', args: ['example'] } },
} as MarketServer;
const registryServer = {
  server: {
    name: 'example',
    version: '1.0.0',
    packages: [{ identifier: 'example', registryType: 'npm' }],
    remotes: [{ type: 'streamable-http', url: 'https://example.com/mcp' }],
  },
} as RegistryServerEntry;

const installButtons = (html: string) => html.match(/<button[^>]*>[^<]*install<\/button>/g) || [];

beforeEach(() => {
  mockIsAdmin = false;
});

test('disables both local install buttons and explains the restriction', () => {
  const html = renderToStaticMarkup(
    createElement(MarketServerDetail, {
      server: localServer,
      onBack: jest.fn(),
      onInstall: jest.fn(),
    }),
  );
  expect(installButtons(html)).toHaveLength(2);
  expect(installButtons(html).every((button) => button.includes('disabled'))).toBe(true);
  expect(html).toContain('server.localExecutionRequiresAdmin');
});

test('disables registry packages while keeping remote installation available', () => {
  const html = renderToStaticMarkup(
    createElement(RegistryServerDetail, {
      serverEntry: registryServer,
      onBack: jest.fn(),
      onInstall: jest.fn(),
    }),
  );
  const buttons = installButtons(html);
  expect(buttons).toHaveLength(2);
  expect(buttons[0]).toContain('disabled');
  expect(buttons[1]).not.toContain('disabled');
  expect(html).toContain('server.localExecutionRequiresAdmin');
});

test('admins can install local and registry configurations', () => {
  mockIsAdmin = true;
  const local = renderToStaticMarkup(
    createElement(MarketServerDetail, {
      server: localServer,
      onBack: jest.fn(),
      onInstall: jest.fn(),
    }),
  );
  const registry = renderToStaticMarkup(
    createElement(RegistryServerDetail, {
      serverEntry: registryServer,
      onBack: jest.fn(),
      onInstall: jest.fn(),
    }),
  );
  expect(installButtons(local + registry)).toHaveLength(4);
  expect(installButtons(local + registry).every((button) => !button.includes('disabled'))).toBe(
    true,
  );
  expect(local + registry).not.toContain('server.localExecutionRequiresAdmin');
});
