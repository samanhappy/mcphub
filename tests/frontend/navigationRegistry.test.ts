import { PERMISSIONS } from '../../frontend/src/constants/permissions';
import {
  ACCOUNT_MENU_ITEMS,
  SIDEBAR_SECTIONS,
  getVisibleSidebarSections,
  isAccountRoute,
  resolveBreadcrumbs,
} from '../../frontend/src/utils/navigationRegistry';

describe('navigationRegistry', () => {
  const fullAdmin = {
    isAdmin: true,
    permissions: ['*', PERMISSIONS.USERS_MANAGE],
  };
  const ordinaryUser = {
    isAdmin: false,
    permissions: [],
  };

  it('keeps sidebar and account menu paths distinct without duplicate /settings entries', () => {
    const sidebarPaths = SIDEBAR_SECTIONS.flatMap((section) => section.items.map((item) => item.path));
    const accountPaths = ACCOUNT_MENU_ITEMS.map((item) => item.path);

    expect(new Set(sidebarPaths).size).toBe(sidebarPaths.length);
    expect(new Set(accountPaths).size).toBe(accountPaths.length);
    expect(accountPaths).not.toContain('/settings');
    expect(sidebarPaths).not.toContain('/credentials');
    expect(accountPaths).toContain('/credentials');
    expect(accountPaths).toContain('/passkeys');
    expect(accountPaths).toContain('/oauth-applications');
  });

  it('assigns distinct icon identifiers across all sidebar and account items', () => {
    const allIcons = [
      ...SIDEBAR_SECTIONS.flatMap((section) => section.items.map((item) => item.icon)),
      ...ACCOUNT_MENU_ITEMS.map((item) => item.icon),
    ];

    expect(new Set(allIcons).size).toBe(allIcons.length);
  });

  it('returns all sections and items for admins when activity is enabled', () => {
    const sections = getVisibleSidebarSections({
      user: fullAdmin,
      activityAvailable: true,
    });

    expect(sections.map((s) => s.id)).toEqual(['workspace', 'capabilities', 'system']);
    expect(sections[0].items.map((i) => i.id)).toEqual(['dashboard', 'servers', 'groups', 'market']);
    expect(sections[1].items.map((i) => i.id)).toEqual(['prompts', 'resources', 'skills']);
    expect(sections[2].items.map((i) => i.id)).toEqual(['users', 'activity', 'logs', 'settings']);
  });

  it('hides activity when unavailable and hides admin-only entries from ordinary users', () => {
    const adminWithoutActivity = getVisibleSidebarSections({
      user: fullAdmin,
      activityAvailable: false,
    });
    expect(adminWithoutActivity[2].items.map((i) => i.id)).toEqual(['users', 'logs', 'settings']);

    const userSections = getVisibleSidebarSections({
      user: ordinaryUser,
      activityAvailable: true,
    });
    expect(userSections.map((s) => s.id)).toEqual(['workspace', 'capabilities', 'system']);
    expect(userSections[1].items.map((i) => i.id)).toEqual(['prompts', 'resources']);
    expect(userSections[2].items.map((i) => i.id)).toEqual(['settings']);
  });

  it('detects account routes accurately', () => {
    expect(isAccountRoute('/credentials')).toBe(true);
    expect(isAccountRoute('/passkeys')).toBe(true);
    expect(isAccountRoute('/oauth-applications')).toBe(true);
    expect(isAccountRoute('/settings')).toBe(false);
    expect(isAccountRoute('/servers')).toBe(false);
  });

  it('resolves clickable breadcrumbs for workspace, market details, and account pages', () => {
    const t = (key: string) => key;

    expect(resolveBreadcrumbs('/', {}, 'MCPHub', t)).toEqual([
      { label: 'MCPHub', to: '/' },
      { label: 'nav.dashboard' },
    ]);

    expect(resolveBreadcrumbs('/market/github', { serverName: 'github' }, 'MCPHub', t)).toEqual([
      { label: 'MCPHub', to: '/' },
      { label: 'nav.market', to: '/market' },
      { label: 'github' },
    ]);

    expect(resolveBreadcrumbs('/passkeys', {}, 'MCPHub', t)).toEqual([
      { label: 'MCPHub', to: '/' },
      { label: 'nav.account', to: '/settings?category=account' },
      { label: 'passkeys.title' },
    ]);

    expect(resolveBreadcrumbs('/credentials', {}, 'MCPHub', t)).toEqual([
      { label: 'MCPHub', to: '/' },
      { label: 'nav.account', to: '/settings?category=account' },
      { label: 'credentials.title' },
    ]);
  });
});
