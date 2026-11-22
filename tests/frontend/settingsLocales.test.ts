import fs from 'fs';
import path from 'path';

describe('settings redesign locale strings', () => {
  const requiredCategoryKeys = [
    'general',
    'generalDesc',
    'access',
    'accessDesc',
    'routing',
    'routingDesc',
    'intelligence',
    'intelligenceDesc',
    'environment',
    'environmentDesc',
    'account',
    'accountDesc',
  ];

  const requiredSettingsKeys = [
    'appearanceDescription',
    'themeLabel',
    'themeDescription',
    'languageDescription',
    'systemSettingsDescription',
    'routeConfigSectionDescription',
    'networkSecurityTitle',
    'networkSecurityDescription',
    'installConfigDescription',
    'changePasswordDescription',
    'accountSecurityHubTitle',
    'accountSecurityHubDescription',
    'credentialsShortcutDescription',
    'searchPlaceholder',
    'searchResultsHeading',
    'searchNoResults',
    'unsavedBadge',
    'unsavedChangesHint',
    'allChangesSaved',
    'discardChanges',
    'unsavedLeaveTitle',
    'unsavedLeaveMessage',
    'discardAndLeave',
    'validationPositiveInteger',
    'validationRange',
  ];

  it('provides all new settings navigation, validation, and draft keys in every supported locale', () => {
    for (const locale of ['en', 'es', 'fr', 'tr', 'vi', 'zh']) {
      const localePath = path.join(process.cwd(), 'locales', `${locale}.json`);
      const translations = JSON.parse(fs.readFileSync(localePath, 'utf8'));

      for (const key of requiredCategoryKeys) {
        expect(translations.settings.categories?.[key]).toBeTruthy();
      }
      for (const key of requiredSettingsKeys) {
        expect(translations.settings[key]).toBeTruthy();
      }
    }
  });
});
