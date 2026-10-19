import { ServerConfig } from '../../src/types/index.js';
import {
  DEFAULT_OAUTH_REDIRECT_URI,
  resolvePreferredRedirectUris,
} from '../../src/utils/oauthRedirectUri.js';

const callback = 'https://public.example.com/oauth/callback';
const systemBase = 'http://internal.example.com/mcphub';

describe('resolvePreferredRedirectUris', () => {
  it.each<{
    name: string;
    oauth?: ServerConfig['oauth'];
    base?: string;
    expected: string[];
  }>([
    {
      name: 'explicit callback',
      oauth: { redirectUri: callback },
      base: systemBase,
      expected: [callback],
    },
    {
      name: 'metadata callbacks',
      oauth: { dynamicRegistration: { metadata: { redirect_uris: [callback] } } },
      base: systemBase,
      expected: [callback],
    },
    {
      name: 'normalized and deduplicated callbacks',
      oauth: {
        redirectUri: `${callback}?server=test`,
        dynamicRegistration: {
          metadata: { redirect_uris: [callback, 'invalid', `${callback}?other=1`] },
        },
      },
      base: systemBase,
      expected: [callback, `${callback}?other=1`],
    },
    { name: 'system fallback', base: systemBase, expected: [`${systemBase}/oauth/callback`] },
    {
      name: 'invalid explicit callbacks',
      oauth: { redirectUri: 'invalid', dynamicRegistration: { metadata: { redirect_uris: [] } } },
      base: systemBase,
      expected: [`${systemBase}/oauth/callback`],
    },
    { name: 'localhost fallback', expected: [DEFAULT_OAUTH_REDIRECT_URI] },
  ])('$name', ({ oauth, base, expected }) => {
    expect(resolvePreferredRedirectUris({ oauth }, base)).toEqual(expected);
  });
});
