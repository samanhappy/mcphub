import { PERMISSIONS } from '../../frontend/src/constants/permissions';
import {
  getVisibleCategories,
  getVisibleSections,
  resolveInitialCategoryAndSection,
  searchSettingsSections,
} from '../../frontend/src/components/settings/settingsRegistry';

describe('settingsRegistry', () => {
  const adminAccess = { isAdmin: true, permissions: [] };
  const userAccess = { isAdmin: false, permissions: [] };
  const smartRoutingOnlyAccess = {
    isAdmin: false,
    permissions: [PERMISSIONS.SETTINGS_SMART_ROUTING],
  };

  it('shows all 6 categories to admins and only user-accessible categories to ordinary users', () => {
    expect(getVisibleCategories(adminAccess).map((c) => c.id)).toEqual([
      'general',
      'access',
      'routing',
      'intelligence',
      'environment',
      'account',
    ]);

    expect(getVisibleCategories(userAccess).map((c) => c.id)).toEqual([
      'general',
      'access',
      'account',
    ]);

    expect(getVisibleSections(userAccess).map((s) => s.id)).toEqual([
      'appearance',
      'bearer-keys',
      'password',
      'account-security',
    ]);
  });

  it('grants scoped categories when non-admin user holds specific settings permissions', () => {
    expect(getVisibleCategories(smartRoutingOnlyAccess).map((c) => c.id)).toContain(
      'intelligence',
    );
    expect(getVisibleSections(smartRoutingOnlyAccess).map((s) => s.id)).toContain('smart-routing');
    expect(getVisibleSections(smartRoutingOnlyAccess).map((s) => s.id)).not.toContain(
      'tool-policies',
    );
  });

  it('resolves deep-link query params and falls back safely when inaccessible', () => {
    expect(resolveInitialCategoryAndSection(null, 'password', userAccess)).toEqual({
      category: 'account',
      section: 'password',
    });

    expect(resolveInitialCategoryAndSection('routing', 'tool-policies', userAccess)).toEqual({
      category: 'general',
      section: null,
    });

    expect(resolveInitialCategoryAndSection(null, 'smart-routing', adminAccess)).toEqual({
      category: 'intelligence',
      section: 'smart-routing',
    });
  });

  it('searches across visible sections using translated titles and keywords', () => {
    const t = (key: string) => key;
    const adminMatches = searchSettingsSections('pgvector embedding', adminAccess, t);
    expect(adminMatches.map((s) => s.id)).toEqual(['smart-routing']);

    const userMatches = searchSettingsSections('pgvector', userAccess, t);
    expect(userMatches).toEqual([]);

    const passkeyMatches = searchSettingsSections('passkey', userAccess, t);
    expect(passkeyMatches.map((s) => s.id)).toEqual(['account-security']);
  });
});
