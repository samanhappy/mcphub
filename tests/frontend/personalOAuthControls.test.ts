import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PersonalOAuthControls from '../../frontend/src/components/PersonalOAuthControls';

jest.mock('../../frontend/src/utils/fetchInterceptor', () => ({
  apiGet: jest.fn(),
  apiPost: jest.fn(),
  apiDelete: jest.fn(),
}));
jest.mock('../../frontend/src/contexts/ToastContext', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));
jest.mock('react-i18next', () => {
  const labels: Record<string, string> = {
    'server.oauth.personalConnect': 'Connect',
    'server.oauth.personalDisconnect': 'Disconnect',
  };
  return { useTranslation: () => ({ t: (key: string) => labels[key] || key }) };
});

test('renders a recovery Disconnect button even without a readable connection status', () => {
  const html = renderToStaticMarkup(createElement(PersonalOAuthControls, { serverName: 'gitlab' }));
  expect(html).toMatch(/<button\b[^>]*>Disconnect<\/button>/);
});
