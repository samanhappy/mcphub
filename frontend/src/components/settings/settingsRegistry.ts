import { PERMISSIONS } from '../../constants/permissions';

export type SettingsCategoryId =
  | 'general'
  | 'access'
  | 'routing'
  | 'intelligence'
  | 'environment'
  | 'account';

export type SettingsSectionId =
  | 'appearance'
  | 'system'
  | 'bearer-keys'
  | 'oauth-server'
  | 'better-auth'
  | 'registration'
  | 'route-config'
  | 'network-security'
  | 'tool-policies'
  | 'smart-routing'
  | 'tool-compression'
  | 'file-staging'
  | 'install-config'
  | 'mcp-router'
  | 'export-config'
  | 'password'
  | 'account-security';

export interface SettingsAccessContext {
  isAdmin: boolean;
  permissions: string[];
}

export interface SettingsSectionMeta {
  id: SettingsSectionId;
  category: SettingsCategoryId;
  titleKey: string;
  descriptionKey: string;
  keywords: string[];
  /** Empty means visible to every authenticated user. */
  requiredPermissions?: string[];
  adminOnly?: boolean;
}

export interface SettingsCategoryMeta {
  id: SettingsCategoryId;
  titleKey: string;
  descriptionKey: string;
}

export const SETTINGS_CATEGORIES: SettingsCategoryMeta[] = [
  {
    id: 'general',
    titleKey: 'settings.categories.general',
    descriptionKey: 'settings.categories.generalDesc',
  },
  {
    id: 'access',
    titleKey: 'settings.categories.access',
    descriptionKey: 'settings.categories.accessDesc',
  },
  {
    id: 'routing',
    titleKey: 'settings.categories.routing',
    descriptionKey: 'settings.categories.routingDesc',
  },
  {
    id: 'intelligence',
    titleKey: 'settings.categories.intelligence',
    descriptionKey: 'settings.categories.intelligenceDesc',
  },
  {
    id: 'environment',
    titleKey: 'settings.categories.environment',
    descriptionKey: 'settings.categories.environmentDesc',
  },
  {
    id: 'account',
    titleKey: 'settings.categories.account',
    descriptionKey: 'settings.categories.accountDesc',
  },
];

export const SETTINGS_SECTIONS: SettingsSectionMeta[] = [
  {
    id: 'appearance',
    category: 'general',
    titleKey: 'pages.settings.appearance',
    descriptionKey: 'settings.appearanceDescription',
    keywords: ['theme', 'dark', 'light', 'language', 'locale', '外观', '主题', '语言'],
  },
  {
    id: 'system',
    category: 'general',
    titleKey: 'settings.systemSettings',
    descriptionKey: 'settings.systemSettingsDescription',
    requiredPermissions: [PERMISSIONS.SETTINGS_SYSTEM_CONFIG],
    keywords: [
      'dashboard',
      'name',
      'branding',
      'separator',
      'normalize',
      'tool',
      'session',
      'rebuild',
      'payload',
      'activity',
      '系统',
      '分隔符',
      '名称',
    ],
  },
  {
    id: 'bearer-keys',
    category: 'access',
    titleKey: 'settings.bearerKeysSectionTitle',
    descriptionKey: 'settings.bearerKeysSectionDescription',
    keywords: [
      'bearer',
      'token',
      'api key',
      'auth',
      'header',
      'passthrough',
      'authorization',
      '密钥',
      '令牌',
    ],
  },
  {
    id: 'oauth-server',
    category: 'access',
    titleKey: 'pages.settings.oauthServer',
    descriptionKey: 'settings.enableOauthServerDescription',
    requiredPermissions: [PERMISSIONS.SETTINGS_OAUTH_SERVER],
    keywords: [
      'oauth',
      'consent',
      'approval',
      'scope',
      'token',
      'lifetime',
      'dcr',
      'dynamic registration',
      'client secret',
      'pkce',
      '授权',
    ],
  },
  {
    id: 'better-auth',
    category: 'access',
    titleKey: 'settings.betterAuthTitle',
    descriptionKey: 'settings.enableBetterAuthDescription',
    requiredPermissions: [PERMISSIONS.SETTINGS_SYSTEM_CONFIG],
    keywords: [
      'better auth',
      'sso',
      'google',
      'github',
      'oidc',
      'trusted origins',
      'password login',
      '单点登录',
    ],
  },
  {
    id: 'registration',
    category: 'access',
    titleKey: 'settings.allowRegistration',
    descriptionKey: 'settings.allowRegistrationDescription',
    requiredPermissions: [PERMISSIONS.SETTINGS_SYSTEM_CONFIG],
    keywords: ['register', 'signup', 'registration', 'account', '注册'],
  },
  {
    id: 'route-config',
    category: 'routing',
    titleKey: 'pages.settings.routeConfig',
    descriptionKey: 'settings.routeConfigSectionDescription',
    requiredPermissions: [PERMISSIONS.SETTINGS_ROUTE_CONFIG],
    keywords: [
      'route',
      'global',
      'group',
      'skip auth',
      'json',
      'body limit',
      '路由',
      '安全',
      '请求体',
    ],
  },
  {
    id: 'network-security',
    category: 'routing',
    titleKey: 'settings.networkSecurityTitle',
    descriptionKey: 'settings.networkSecurityDescription',
    adminOnly: true,
    keywords: ['cidr', 'ssrf', 'fake ip', 'network', 'allowlist', 'hostname', '网络', '白名单'],
  },
  {
    id: 'tool-policies',
    category: 'routing',
    titleKey: 'settings.toolPolicies.title',
    descriptionKey: 'settings.toolPolicies.description',
    adminOnly: true,
    keywords: ['policy', 'tool', 'allow', 'deny', 'acl', 'rule', '策略', '权限', '工具'],
  },
  {
    id: 'smart-routing',
    category: 'intelligence',
    titleKey: 'pages.settings.smartRouting',
    descriptionKey: 'settings.enableSmartRoutingDescription',
    requiredPermissions: [PERMISSIONS.SETTINGS_SMART_ROUTING],
    keywords: [
      'smart routing',
      'embedding',
      'vector',
      'pgvector',
      'openai',
      'azure',
      'gemini',
      'siliconflow',
      'openrouter',
      'reindex',
      'progressive',
      'similarity',
      '智能路由',
      '向量',
      '索引',
    ],
  },
  {
    id: 'tool-compression',
    category: 'intelligence',
    titleKey: 'settings.toolResultCompressionTitle',
    descriptionKey: 'settings.toolResultCompressionDescription',
    requiredPermissions: [PERMISSIONS.SETTINGS_SMART_ROUTING],
    keywords: ['compression', 'compress', 'tokens', 'budget', 'strategy', '压缩', '上下文'],
  },
  {
    id: 'file-staging',
    category: 'intelligence',
    titleKey: 'settings.fileStagingTitle',
    descriptionKey: 'settings.fileStagingDescription',
    requiredPermissions: [PERMISSIONS.SETTINGS_SYSTEM_CONFIG],
    keywords: ['file', 'staging', 'quota', 'upload', 'download', 'ttl', '文件', '暂存', '配额'],
  },
  {
    id: 'install-config',
    category: 'environment',
    titleKey: 'settings.installConfig',
    descriptionKey: 'settings.installConfigDescription',
    requiredPermissions: [PERMISSIONS.SETTINGS_INSTALL_CONFIG],
    keywords: [
      'install',
      'base url',
      'pypi',
      'python',
      'npm',
      'registry',
      'proxy',
      'skill',
      'cache',
      'clear',
      '安装',
      '镜像',
      '缓存',
      '代理',
    ],
  },
  {
    id: 'mcp-router',
    category: 'environment',
    titleKey: 'settings.mcpRouterConfig',
    descriptionKey: 'settings.mcpRouterApiKeyDescription',
    requiredPermissions: [PERMISSIONS.SETTINGS_INSTALL_CONFIG],
    keywords: ['mcprouter', 'router', 'api key', 'market', 'cloud'],
  },
  {
    id: 'export-config',
    category: 'environment',
    titleKey: 'settings.exportMcpSettings',
    descriptionKey: 'settings.mcpSettingsJsonDescription',
    requiredPermissions: [PERMISSIONS.SETTINGS_EXPORT_CONFIG],
    keywords: ['export', 'json', 'download', 'backup', 'mcp_settings', '导出', '备份'],
  },
  {
    id: 'password',
    category: 'account',
    titleKey: 'auth.changePassword',
    descriptionKey: 'settings.changePasswordDescription',
    keywords: ['password', 'change password', 'security', '密码', '修改密码'],
  },
  {
    id: 'account-security',
    category: 'account',
    titleKey: 'settings.accountSecurityHubTitle',
    descriptionKey: 'settings.accountSecurityHubDescription',
    keywords: [
      'passkey',
      'webauthn',
      'oauth',
      'applications',
      'approvals',
      'credentials',
      '通行密钥',
      '授权应用',
      '凭证',
    ],
  },
];

export function canAccessSettingsSection(
  section: SettingsSectionMeta,
  access: SettingsAccessContext,
): boolean {
  if (section.adminOnly && !access.isAdmin) {
    return false;
  }
  if (!section.requiredPermissions || section.requiredPermissions.length === 0) {
    return true;
  }
  if (access.isAdmin || access.permissions.includes('*')) {
    return true;
  }
  return section.requiredPermissions.some((perm) => access.permissions.includes(perm));
}

export function getVisibleSections(access: SettingsAccessContext): SettingsSectionMeta[] {
  return SETTINGS_SECTIONS.filter((section) => canAccessSettingsSection(section, access));
}

export function getVisibleCategories(access: SettingsAccessContext): SettingsCategoryMeta[] {
  const visibleSections = getVisibleSections(access);
  const visibleCategoryIds = new Set(visibleSections.map((section) => section.category));
  return SETTINGS_CATEGORIES.filter((category) => visibleCategoryIds.has(category.id));
}

export function resolveInitialCategoryAndSection(
  categoryParam: string | null,
  sectionParam: string | null,
  access: SettingsAccessContext,
): { category: SettingsCategoryId; section: SettingsSectionId | null } {
  const visibleSections = getVisibleSections(access);
  const visibleCategories = getVisibleCategories(access);
  const fallbackCategory = visibleCategories[0]?.id ?? 'general';

  if (sectionParam) {
    const matchedSection = visibleSections.find((s) => s.id === sectionParam);
    if (matchedSection) {
      return { category: matchedSection.category, section: matchedSection.id };
    }
  }

  if (categoryParam) {
    const matchedCategory = visibleCategories.find((c) => c.id === categoryParam);
    if (matchedCategory) {
      return { category: matchedCategory.id, section: null };
    }
  }

  return { category: fallbackCategory, section: null };
}

export function searchSettingsSections(
  query: string,
  access: SettingsAccessContext,
  translate: (key: string) => string,
): SettingsSectionMeta[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];

  const tokens = normalized.split(/\s+/).filter(Boolean);
  return getVisibleSections(access).filter((section) => {
    const haystack = [
      section.id,
      translate(section.titleKey),
      translate(section.descriptionKey),
      ...section.keywords,
    ]
      .join(' ')
      .toLowerCase();
    return tokens.every((token) => haystack.includes(token));
  });
}
