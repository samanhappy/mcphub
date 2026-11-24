import fs from 'fs';
import path from 'path';

describe('navigation locale strings', () => {
  const requiredNavKeys = [
    'dashboard',
    'servers',
    'groups',
    'market',
    'prompts',
    'resources',
    'users',
    'activity',
    'logs',
    'settings',
    'changePassword',
    'workspace',
    'capabilities',
    'system',
    'account',
    'breadcrumb',
  ];

  const requiredHeaderKeys = ['github', 'documentation'];

  it('provides all navigation and header keys in every supported locale', () => {
    for (const locale of ['en', 'es', 'fr', 'tr', 'vi', 'zh']) {
      const localePath = path.join(process.cwd(), 'locales', `${locale}.json`);
      const translations = JSON.parse(fs.readFileSync(localePath, 'utf8'));

      for (const key of requiredNavKeys) {
        expect(translations.nav?.[key]).toBeTruthy();
      }
      for (const key of requiredHeaderKeys) {
        expect(translations.header?.[key]).toBeTruthy();
      }
    }
  });
});
