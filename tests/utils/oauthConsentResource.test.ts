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

it('recognizes custom and legacy smart resources with a base path, user and group', () => {
  const oldPath = process.env.SMART_ROUTING_PATH;
  const oldBase = process.env.BASE_PATH;
  process.env.SMART_ROUTING_PATH = 'my_smart';
  process.env.BASE_PATH = '/hub';
  try {
    for (const path of [
      '/hub/mcp/my_smart',
      '/hub/alice/mcp/my_smart/team',
      '/hub/mcp/%24smart/team',
    ]) {
      expect(parseResourceTarget(`https://example.com${path}`)).toMatchObject({
        kind: 'smart',
        path,
      });
    }
    expect(parseResourceTarget('/hub/mcp/my_smart-other').kind).not.toBe('smart');
  } finally {
    if (oldPath === undefined) delete process.env.SMART_ROUTING_PATH;
    else process.env.SMART_ROUTING_PATH = oldPath;
    if (oldBase === undefined) delete process.env.BASE_PATH;
    else process.env.BASE_PATH = oldBase;
  }
});
