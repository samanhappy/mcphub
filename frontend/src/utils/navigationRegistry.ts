import {
  canManageSkills,
  canManageUsers,
  canViewActivity,
  canViewSystemLogs,
  type NavigationUser,
} from './navigationPermissions';

export type NavSectionId = 'workspace' | 'capabilities' | 'system';

export type NavIconId =
  | 'dashboard'
  | 'servers'
  | 'groups'
  | 'market'
  | 'prompts'
  | 'resources'
  | 'skills'
  | 'users'
  | 'activity'
  | 'logs'
  | 'settings'
  | 'credentials'
  | 'passkeys'
  | 'oauthApplications'
  | 'changePassword';

export type NavAccessRule =
  | 'authenticated'
  | 'manageUsers'
  | 'manageSkills'
  | 'viewLogs'
  | 'viewActivity';

export interface NavItemMeta {
  id: string;
  path: string;
  labelKey: string;
  icon: NavIconId;
  end?: boolean;
  access: NavAccessRule;
  badgeKey?: 'servers' | 'groups';
}

export interface NavSectionMeta {
  id: NavSectionId;
  labelKey: string;
  items: NavItemMeta[];
}

export interface AccountMenuItemMeta {
  id: string;
  path: string;
  matchPath?: string;
  labelKey: string;
  icon: NavIconId;
}

export interface NavAccessContext {
  user: NavigationUser;
  activityAvailable?: boolean;
}

export interface BreadcrumbItem {
  label: string;
  to?: string;
}

export const SIDEBAR_SECTIONS: NavSectionMeta[] = [
  {
    id: 'workspace',
    labelKey: 'nav.workspace',
    items: [
      {
        id: 'dashboard',
        path: '/',
        labelKey: 'nav.dashboard',
        icon: 'dashboard',
        end: true,
        access: 'authenticated',
      },
      {
        id: 'servers',
        path: '/servers',
        labelKey: 'nav.servers',
        icon: 'servers',
        access: 'authenticated',
        badgeKey: 'servers',
      },
      {
        id: 'groups',
        path: '/groups',
        labelKey: 'nav.groups',
        icon: 'groups',
        access: 'authenticated',
        badgeKey: 'groups',
      },
      {
        id: 'market',
        path: '/market',
        labelKey: 'nav.market',
        icon: 'market',
        access: 'authenticated',
      },
    ],
  },
  {
    id: 'capabilities',
    labelKey: 'nav.capabilities',
    items: [
      {
        id: 'prompts',
        path: '/prompts',
        labelKey: 'nav.prompts',
        icon: 'prompts',
        access: 'authenticated',
      },
      {
        id: 'resources',
        path: '/resources',
        labelKey: 'nav.resources',
        icon: 'resources',
        access: 'authenticated',
      },
      {
        id: 'skills',
        path: '/skills',
        labelKey: 'skills.title',
        icon: 'skills',
        access: 'manageSkills',
      },
    ],
  },
  {
    id: 'system',
    labelKey: 'nav.system',
    items: [
      {
        id: 'users',
        path: '/users',
        labelKey: 'nav.users',
        icon: 'users',
        access: 'manageUsers',
      },
      {
        id: 'activity',
        path: '/activity',
        labelKey: 'nav.activity',
        icon: 'activity',
        access: 'viewActivity',
      },
      {
        id: 'logs',
        path: '/logs',
        labelKey: 'nav.logs',
        icon: 'logs',
        access: 'viewLogs',
      },
      {
        id: 'settings',
        path: '/settings',
        labelKey: 'nav.settings',
        icon: 'settings',
        access: 'authenticated',
      },
    ],
  },
];

export const ACCOUNT_MENU_ITEMS: AccountMenuItemMeta[] = [
  {
    id: 'credentials',
    path: '/credentials',
    matchPath: '/credentials',
    labelKey: 'credentials.title',
    icon: 'credentials',
  },
  {
    id: 'passkeys',
    path: '/passkeys',
    matchPath: '/passkeys',
    labelKey: 'passkeys.title',
    icon: 'passkeys',
  },
  {
    id: 'oauth-applications',
    path: '/oauth-applications',
    matchPath: '/oauth-applications',
    labelKey: 'oauthApprovals.title',
    icon: 'oauthApplications',
  },
  {
    id: 'change-password',
    path: '/settings?category=account&section=password',
    labelKey: 'nav.changePassword',
    icon: 'changePassword',
  },
];

export const canAccessNavRule = (rule: NavAccessRule, context: NavAccessContext): boolean => {
  switch (rule) {
    case 'authenticated':
      return true;
    case 'manageUsers':
      return canManageUsers(context.user);
    case 'manageSkills':
      return canManageSkills(context.user);
    case 'viewLogs':
      return canViewSystemLogs(context.user);
    case 'viewActivity':
      return Boolean(context.activityAvailable) && canViewActivity(context.user);
  }
};

export const getVisibleSidebarSections = (context: NavAccessContext): NavSectionMeta[] =>
  SIDEBAR_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => canAccessNavRule(item.access, context)),
  })).filter((section) => section.items.length > 0);

const ACCOUNT_ROUTE_PREFIXES = ACCOUNT_MENU_ITEMS.map((item) => item.matchPath).filter(
  (matchPath): matchPath is string => Boolean(matchPath),
);

export const isAccountRoute = (pathname: string): boolean =>
  ACCOUNT_ROUTE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));

const ALL_SIDEBAR_ITEMS = SIDEBAR_SECTIONS.flatMap((section) => section.items);

export const resolveBreadcrumbs = (
  pathname: string,
  params: Readonly<Record<string, string | undefined>>,
  rootLabel: string,
  translate: (key: string) => string,
): BreadcrumbItem[] => {
  if (pathname === '/') {
    return [{ label: rootLabel, to: '/' }, { label: translate('nav.dashboard') }];
  }

  const matchedAccount = ACCOUNT_MENU_ITEMS.find(
    (item) =>
      item.matchPath && (pathname === item.matchPath || pathname.startsWith(`${item.matchPath}/`)),
  );
  if (matchedAccount) {
    return [
      { label: rootLabel, to: '/' },
      { label: translate('nav.account'), to: '/settings?category=account' },
      { label: translate(matchedAccount.labelKey) },
    ];
  }

  if (pathname === '/market' || pathname.startsWith('/market/')) {
    const serverName = params.serverName;
    if (serverName) {
      return [
        { label: rootLabel, to: '/' },
        { label: translate('nav.market'), to: '/market' },
        { label: serverName },
      ];
    }
    return [{ label: rootLabel, to: '/' }, { label: translate('nav.market') }];
  }

  const matchedItem = ALL_SIDEBAR_ITEMS.find(
    (item) =>
      item.path !== '/' && (pathname === item.path || pathname.startsWith(`${item.path}/`)),
  );
  if (matchedItem) {
    return [{ label: rootLabel, to: '/' }, { label: translate(matchedItem.labelKey) }];
  }

  return [{ label: rootLabel }];
};
