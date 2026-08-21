import { parseResourceTarget } from '../../src/utils/oauthConsentResource.js';

describe('parseResourceTarget', () => {
  it('maps a bare install URL (aggregate /mcp connector) to "all"', () => {
    expect(parseResourceTarget('https://mcphub.example.com/')).toEqual({
      raw: 'https://mcphub.example.com/',
      path: '',
      kind: 'all',
    });
    expect(parseResourceTarget('https://mcphub.example.com')).toEqual({
      raw: 'https://mcphub.example.com',
      path: '',
      kind: 'all',
    });
  });

  it('maps /mcp to "all"', () => {
    expect(parseResourceTarget('https://mcphub.example.com/mcp')).toMatchObject({
      kind: 'all',
      path: '/mcp',
    });
  });

  it('maps /mcp/$smart to "smart"', () => {
    expect(parseResourceTarget('https://mcphub.example.com/mcp/$smart')).toMatchObject({
      kind: 'smart',
      path: '/mcp/$smart',
    });
  });

  it('maps /mcp/{name} to a named target', () => {
    expect(parseResourceTarget('https://mcphub.example.com/mcp/toggl')).toMatchObject({
      kind: 'target',
      name: 'toggl',
      path: '/mcp/toggl',
    });
  });

  it('decodes URL-encoded target names', () => {
    expect(parseResourceTarget('https://mcphub.example.com/mcp/my%20group')).toMatchObject({
      kind: 'target',
      name: 'my group',
    });
  });

  it('accepts relative resource paths', () => {
    expect(parseResourceTarget('/mcp/toggl')).toMatchObject({
      kind: 'target',
      name: 'toggl',
    });
  });

  it('surfaces unrecognized URIs as unknown rather than throwing', () => {
    expect(parseResourceTarget('not a url')).toMatchObject({ kind: 'unknown' });
    expect(parseResourceTarget('https://example.com/something/else')).toMatchObject({
      kind: 'unknown',
    });
  });
});
