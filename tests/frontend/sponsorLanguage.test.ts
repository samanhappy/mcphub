import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18next from 'i18next';
import { I18nextProvider } from 'react-i18next';
import SponsorDialog from '../../frontend/src/components/ui/SponsorDialog';

it.each([
  ['zh', true],
  ['zh-CN', true],
  ['zh-TW', true],
  ['en-US', false],
  ['de-DE', false],
])('selects the correct sponsorship method for %s', async (language, chinese) => {
  const i18n = i18next.createInstance();
  await i18n.init({
    lng: language,
    fallbackLng: 'en',
    resources: {
      en: { translation: { sponsor: { title: 'Sponsor' } } },
      zh: { translation: { sponsor: { title: '赞助' } } },
    },
  });

  const html = renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(SponsorDialog, { open: true, onOpenChange: () => undefined }),
    ),
  );

  expect(html.includes('./assets/reward.png')).toBe(chinese);
  const links = [...html.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((match) => match[1]);
  expect(links).toEqual(chinese ? [] : ['https://ko-fi.com/samanhappy']);
});
