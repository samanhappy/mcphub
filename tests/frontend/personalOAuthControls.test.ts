import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PersonalOAuthControls from '../../frontend/src/components/PersonalOAuthControls';
import { apiPost, apiDelete } from '../../frontend/src/utils/fetchInterceptor';

jest.mock('../../frontend/src/utils/fetchInterceptor', () => ({
  apiGet: jest.fn(),
  apiPost: jest.fn(),
  apiDelete: jest.fn(),
}));
jest.mock('../../frontend/src/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

test('renders only authorization when disconnected', () => {
  const html = renderToStaticMarkup(createElement(PersonalOAuthControls, { serverName: 'gitlab' }));
  expect(html).toContain('class="hub-btn whitespace-nowrap"');
  expect(html).toContain('status.oauthRequired</button>');
  expect(html).not.toContain('server.oauth.personalDisconnect');
  expect(html).not.toContain('<details>');
});

test('does not allow connecting a disabled server', () => {
  const html = renderToStaticMarkup(
    createElement(PersonalOAuthControls, { serverName: 'gitlab', enabled: false }),
  );
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>server.disable<\/button>/);
});

// Exercise the click handler without adding a DOM renderer dependency.
test.each([true, false])(
  'opens before discovery resolves and closes on failure=%s',
  async (fails) => {
    const React = jest.requireActual<typeof import('react')>('react');
    const setState = jest.fn();
    const state = jest
      .spyOn(React, 'useState')
      .mockImplementation((initial) => [initial, setState] as never);
    const effect = jest.spyOn(React, 'useEffect').mockImplementation(() => undefined);
    const popup = { opener: {}, location: { replace: jest.fn() }, close: jest.fn() };
    const open = jest.fn(() => popup);
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { open } });
    let resolve!: (value: unknown) => void;
    jest.mocked(apiPost).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    try {
      const tree = PersonalOAuthControls({ serverName: 'gitlab' });
      tree.props.children.props.onClick();
      expect(open).toHaveBeenCalledWith('about:blank', '_blank');
      expect(popup.opener).toBeNull();
      expect(open.mock.invocationCallOrder[0]).toBeLessThan(
        jest.mocked(apiPost).mock.invocationCallOrder.at(-1)!,
      );
      resolve(
        fails
          ? { success: false }
          : { success: true, data: { authorizationUrl: 'https://example.com/authorize' } },
      );
      await new Promise((done) => setImmediate(done));
      if (fails) expect(popup.close).toHaveBeenCalled();
      else expect(popup.location.replace).toHaveBeenCalledWith('https://example.com/authorize');
      expect(apiDelete).not.toHaveBeenCalled();
    } finally {
      state.mockRestore();
      effect.mockRestore();
      Reflect.deleteProperty(globalThis, 'window');
    }
  },
);

test('keeps connected actions inside a disclosure menu', () => {
  const React = jest.requireActual<typeof import('react')>('react');
  const state = jest.spyOn(React, 'useState');
  state.mockImplementationOnce(() => [true, jest.fn()] as never);
  try {
    const html = renderToStaticMarkup(
      createElement(PersonalOAuthControls, { serverName: 'gitlab' }),
    );
    expect(html).toContain('<details>');
    expect(html).toContain('server.oauth.personalReconnect');
    expect(html).toContain('server.oauth.personalDisconnect');
    expect(html).not.toContain('flex-wrap');
  } finally {
    state.mockRestore();
  }
});
