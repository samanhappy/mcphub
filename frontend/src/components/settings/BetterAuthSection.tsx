import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import { PermissionChecker } from '@/components/PermissionChecker';
import { PERMISSIONS } from '@/constants/permissions';
import { useRuntimeSettings, useSettingsActions } from '@/hooks/useSettingsData';
import { useSettingsDraft } from '@/hooks/useSettingsDraft';
import type { BetterAuthConfig } from '@/contexts/settingsTypes';
import {
  SettingsAlert,
  SettingsCard,
  SettingsRow,
  SettingsSaveBar,
  SettingsStatusBadge,
  SettingsToggleRow,
  settingsInputClass,
} from './SettingsPrimitives';

const DEFAULT_OIDC_SCOPES = ['openid', 'profile', 'email'];

const parseCommaSeparated = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

interface BetterAuthSectionProps {
  highlightedSection?: string | null;
  onDirtyChange?: (sectionId: string, dirty: boolean) => void;
}

export const BetterAuthSection: React.FC<BetterAuthSectionProps> = ({
  highlightedSection,
  onDirtyChange,
}) => {
  const { t } = useTranslation();
  const { betterAuthConfig, initialLoading } = useRuntimeSettings();
  const { isSectionSaving, updateBetterAuthConfigBatch } = useSettingsActions();

  const remoteForm = useMemo(
    () => ({
      baseUrl: betterAuthConfig.baseUrl || '',
      basePath: betterAuthConfig.basePath || '/api/auth/better',
      trustedOrigins: betterAuthConfig.trustedOrigins?.join(', ') || '',
      oidcProviderId: betterAuthConfig.providers.oidc.providerId || 'oidc',
      oidcDiscoveryUrl: betterAuthConfig.providers.oidc.discoveryUrl || '',
      oidcScopes:
        betterAuthConfig.providers.oidc.scopes?.join(', ') || DEFAULT_OIDC_SCOPES.join(', '),
      oidcPrompt: betterAuthConfig.providers.oidc.prompt || '',
    }),
    [betterAuthConfig],
  );

  const draft = useSettingsDraft(remoteForm);
  const saving = isSectionSaving('betterAuth');
  const busy = initialLoading || saving;

  useEffect(() => {
    onDirtyChange?.('better-auth', draft.dirty);
    return () => onDirtyChange?.('better-auth', false);
  }, [draft.dirty, onDirtyChange]);

  const handleSave = async () => {
    const updates: Partial<BetterAuthConfig> = {};
    const normalizedBaseUrl = draft.values.baseUrl.trim();
    const normalizedBasePath = draft.values.basePath.trim() || '/api/auth/better';
    const normalizedTrustedOrigins = parseCommaSeparated(draft.values.trustedOrigins);
    const normalizedProviderId = draft.values.oidcProviderId.trim() || 'oidc';
    const normalizedDiscoveryUrl = draft.values.oidcDiscoveryUrl.trim();
    const parsedScopes = parseCommaSeparated(draft.values.oidcScopes);
    const normalizedScopes = parsedScopes.length > 0 ? parsedScopes : [...DEFAULT_OIDC_SCOPES];
    const normalizedPrompt = draft.values.oidcPrompt.trim();

    if (normalizedBaseUrl !== (betterAuthConfig.baseUrl || '')) {
      updates.baseUrl = normalizedBaseUrl;
    }
    if (normalizedBasePath !== betterAuthConfig.basePath) {
      updates.basePath = normalizedBasePath;
    }
    if (normalizedTrustedOrigins.join('|') !== (betterAuthConfig.trustedOrigins || []).join('|')) {
      updates.trustedOrigins = normalizedTrustedOrigins;
    }

    const oidcUpdates: Partial<BetterAuthConfig['providers']['oidc']> = {};
    if (normalizedProviderId !== betterAuthConfig.providers.oidc.providerId) {
      oidcUpdates.providerId = normalizedProviderId;
    }
    if (normalizedDiscoveryUrl !== (betterAuthConfig.providers.oidc.discoveryUrl || '')) {
      oidcUpdates.discoveryUrl = normalizedDiscoveryUrl;
    }
    if (normalizedScopes.join('|') !== betterAuthConfig.providers.oidc.scopes.join('|')) {
      oidcUpdates.scopes = normalizedScopes;
    }
    if (normalizedPrompt !== (betterAuthConfig.providers.oidc.prompt || '')) {
      oidcUpdates.prompt = normalizedPrompt;
    }

    if (Object.keys(oidcUpdates).length > 0) {
      updates.providers = {
        ...betterAuthConfig.providers,
        oidc: {
          ...betterAuthConfig.providers.oidc,
          ...oidcUpdates,
        },
      };
    }

    if (Object.keys(updates).length === 0) {
      draft.discard();
      return;
    }

    const ok = await updateBetterAuthConfigBatch(updates);
    if (ok) {
      draft.discard();
    }
  };

  return (
    <PermissionChecker permissions={PERMISSIONS.SETTINGS_SYSTEM_CONFIG}>
      <SettingsCard
        id="better-auth"
        title={t('settings.betterAuthTitle') || 'Better Auth'}
        description={t('settings.enableBetterAuthDescription')}
        icon={<Lock size={15} />}
        badge={<SettingsStatusBadge active={betterAuthConfig.enabled} />}
        dirty={draft.dirty}
        highlighted={highlightedSection === 'better-auth'}
      >
        <SettingsAlert variant="info">
          {t('settings.betterAuthEnvNote') ||
            'Client IDs and secrets still come from environment variables. Changing Better Auth settings may require an application restart, and the install base URL origin is trusted automatically.'}
        </SettingsAlert>

        <div className="grid gap-3 md:grid-cols-2">
          <SettingsToggleRow
            id="better-auth-enabled"
            label={t('settings.enableBetterAuth') || 'Enable Better Auth'}
            description={t('settings.enableBetterAuthDescription')}
            checked={betterAuthConfig.enabled}
            disabled={busy}
            onCheckedChange={(checked) => void updateBetterAuthConfigBatch({ enabled: checked })}
          />

          <SettingsToggleRow
            id="disable-password-login"
            label={t('settings.disablePasswordLogin')}
            description={t('settings.disablePasswordLoginDescription')}
            checked={betterAuthConfig.disablePasswordLogin}
            disabled={busy}
            onCheckedChange={(checked) =>
              void updateBetterAuthConfigBatch({ disablePasswordLogin: checked })
            }
          />
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <SettingsRow
            htmlFor="better-auth-base-url"
            label={t('settings.betterAuthBaseUrl') || 'Base URL'}
            description={t('settings.betterAuthBaseUrlDescription')}
          >
            <input
              id="better-auth-base-url"
              type="text"
              value={draft.values.baseUrl}
              onChange={(e) => draft.setField('baseUrl', e.target.value)}
              placeholder="https://mcphub.example.com"
              className={`${settingsInputClass} mono`}
              disabled={busy}
            />
          </SettingsRow>

          <SettingsRow
            htmlFor="better-auth-base-path"
            label={t('settings.betterAuthBasePath') || 'Auth base path'}
            description={t('settings.betterAuthBasePathDescription')}
          >
            <input
              id="better-auth-base-path"
              type="text"
              value={draft.values.basePath}
              onChange={(e) => draft.setField('basePath', e.target.value)}
              placeholder="/api/auth/better"
              className={`${settingsInputClass} mono`}
              disabled={busy}
            />
          </SettingsRow>
        </div>

        <SettingsRow
          htmlFor="better-auth-trusted-origins"
          label={t('settings.betterAuthTrustedOrigins') || 'Trusted origins'}
          description={t('settings.betterAuthTrustedOriginsDescription')}
        >
          <input
            id="better-auth-trusted-origins"
            type="text"
            value={draft.values.trustedOrigins}
            onChange={(e) => draft.setField('trustedOrigins', e.target.value)}
            placeholder="https://app.example.com, https://admin.example.com"
            className={`${settingsInputClass} mono`}
            disabled={busy}
          />
        </SettingsRow>

        <div className="space-y-3 rounded-lg border border-[var(--hub-line)] bg-[var(--hub-surface)] p-3.5">
          <div>
            <h3 className="text-[13px] font-medium text-[var(--hub-ink)]">
              {t('settings.betterAuthProviders') || 'Providers'}
            </h3>
            <p className="mt-0.5 text-xs text-[var(--hub-ink-3)]">
              {t('settings.betterAuthProvidersDescription')}
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <SettingsToggleRow
              id="better-auth-google"
              label="Google"
              description={t('settings.betterAuthGoogleDescription')}
              checked={betterAuthConfig.providers.google.enabled}
              disabled={busy}
              onCheckedChange={(checked) =>
                void updateBetterAuthConfigBatch({
                  providers: {
                    ...betterAuthConfig.providers,
                    google: { enabled: checked },
                  },
                })
              }
            />

            <SettingsToggleRow
              id="better-auth-github"
              label="GitHub"
              description={t('settings.betterAuthGithubDescription')}
              checked={betterAuthConfig.providers.github.enabled}
              disabled={busy}
              onCheckedChange={(checked) =>
                void updateBetterAuthConfigBatch({
                  providers: {
                    ...betterAuthConfig.providers,
                    github: { enabled: checked },
                  },
                })
              }
            />

            <SettingsToggleRow
              id="better-auth-oidc"
              label="OIDC"
              description={t('settings.betterAuthOidcDescription')}
              checked={betterAuthConfig.providers.oidc.enabled}
              disabled={busy}
              onCheckedChange={(checked) =>
                void updateBetterAuthConfigBatch({
                  providers: {
                    ...betterAuthConfig.providers,
                    oidc: { ...betterAuthConfig.providers.oidc, enabled: checked },
                  },
                })
              }
            />
          </div>
        </div>

        {betterAuthConfig.providers.oidc.enabled && (
          <div className="space-y-3 rounded-lg border border-[var(--hub-line)] bg-[var(--hub-surface)] p-3.5">
            <div className="grid gap-3 md:grid-cols-2">
              <SettingsRow
                htmlFor="better-auth-oidc-provider-id"
                label={t('settings.betterAuthOidcProviderId') || 'OIDC provider ID'}
                description={t('settings.betterAuthOidcProviderIdDescription')}
              >
                <input
                  id="better-auth-oidc-provider-id"
                  type="text"
                  value={draft.values.oidcProviderId}
                  onChange={(e) => draft.setField('oidcProviderId', e.target.value)}
                  placeholder="oidc"
                  className={`${settingsInputClass} mono`}
                  disabled={busy}
                />
              </SettingsRow>

              <SettingsRow
                htmlFor="better-auth-oidc-discovery-url"
                label={t('settings.betterAuthOidcDiscoveryUrl') || 'OIDC discovery URL'}
                description={t('settings.betterAuthOidcDiscoveryUrlDescription')}
              >
                <input
                  id="better-auth-oidc-discovery-url"
                  type="text"
                  value={draft.values.oidcDiscoveryUrl}
                  onChange={(e) => draft.setField('oidcDiscoveryUrl', e.target.value)}
                  placeholder="https://issuer.example.com/.well-known/openid-configuration"
                  className={`${settingsInputClass} mono`}
                  disabled={busy}
                />
              </SettingsRow>

              <SettingsRow
                htmlFor="better-auth-oidc-scopes"
                label={t('settings.betterAuthOidcScopes') || 'OIDC scopes'}
                description={t('settings.betterAuthOidcScopesDescription')}
              >
                <input
                  id="better-auth-oidc-scopes"
                  type="text"
                  value={draft.values.oidcScopes}
                  onChange={(e) => draft.setField('oidcScopes', e.target.value)}
                  placeholder="openid, profile, email"
                  className={`${settingsInputClass} mono`}
                  disabled={busy}
                />
              </SettingsRow>

              <SettingsRow
                htmlFor="better-auth-oidc-prompt"
                label={t('settings.betterAuthOidcPrompt') || 'OIDC prompt'}
                description={t('settings.betterAuthOidcPromptDescription')}
              >
                <input
                  id="better-auth-oidc-prompt"
                  type="text"
                  value={draft.values.oidcPrompt}
                  onChange={(e) => draft.setField('oidcPrompt', e.target.value)}
                  placeholder="login"
                  className={`${settingsInputClass} mono`}
                  disabled={busy}
                />
              </SettingsRow>
            </div>

            <SettingsToggleRow
              id="better-auth-oidc-pkce"
              label={t('settings.betterAuthOidcPkce') || 'Enable PKCE'}
              description={t('settings.betterAuthOidcPkceDescription')}
              checked={betterAuthConfig.providers.oidc.pkce}
              disabled={busy}
              onCheckedChange={(checked) =>
                void updateBetterAuthConfigBatch({
                  providers: {
                    ...betterAuthConfig.providers,
                    oidc: { ...betterAuthConfig.providers.oidc, pkce: checked },
                  },
                })
              }
            />
          </div>
        )}

        <SettingsSaveBar
          dirty={draft.dirty}
          saving={saving}
          disabled={initialLoading}
          onSave={handleSave}
          onDiscard={draft.discard}
        />
      </SettingsCard>
    </PermissionChecker>
  );
};

export default BetterAuthSection;
