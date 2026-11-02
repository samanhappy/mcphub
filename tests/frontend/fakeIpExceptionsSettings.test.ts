import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import FakeIpExceptionsSettings from '../../frontend/src/components/FakeIpExceptionsSettings';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const props = {
  value: [{ serverId: 'stable-id', hostname: 'mcp.example.com' }],
  servers: [{ name: 'Public MCP', config: { id: 'stable-id' } }] as never,
  loading: false,
  onSave: jest.fn(),
};

it('shows names while selecting stable IDs, and retains unavailable saved servers', () => {
  const html = renderToStaticMarkup(createElement(FakeIpExceptionsSettings, props));
  expect(html).toContain('value="stable-id" selected="">Public MCP');
  const missing = renderToStaticMarkup(
    createElement(FakeIpExceptionsSettings, { ...props, servers: [] }),
  );
  expect(missing).toContain('value="stable-id" selected="">settings.fakeIp.unavailable');
  expect(missing).toContain('value="mcp.example.com"');
});

it('uses browser validation to reject IPs, wildcards, URLs, ports and invalid DNS labels', () => {
  const html = renderToStaticMarkup(createElement(FakeIpExceptionsSettings, props));
  const pattern = new RegExp(`^(?:${html.match(/pattern="([^"]+)"/)![1]})$`, 'v');
  for (const hostname of ['mcp.example.com', 'my-mcp.example.com', 'xn--bcher-kva.example']) {
    expect(pattern.test(hostname)).toBe(true);
  }
  for (const hostname of [
    '*.example.com',
    '127.0.0.1',
    'https://example.com',
    'example.com:443',
    'example.com.',
    '-bad.example',
    'bad..example',
  ]) {
    expect(pattern.test(hostname)).toBe(false);
  }
  expect(html).toContain('maxLength="253"');
  expect(html).toContain('required=""');
});

it('disables editing and saving while a request is in progress', () => {
  const html = renderToStaticMarkup(
    createElement(FakeIpExceptionsSettings, { ...props, loading: true }),
  );
  expect(html).toMatch(/<select[^>]*disabled=""/);
  expect(html).toMatch(/<input[^>]*disabled=""/);
  expect(html).toMatch(/<button type="submit"[^>]*disabled=""/);
});
