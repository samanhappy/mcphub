import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Lock } from 'lucide-react';
import { PermissionChecker } from '@/components/PermissionChecker';
import { PERMISSIONS } from '@/constants/permissions';
import { useRuntimeSettings, useSettingsActions } from '@/hooks/useSettingsData';
import { useSettingsDraft } from '@/hooks/useSettingsDraft';
import type { OAuthServerConfig } from '@/contexts/settingsTypes';
import {
  SettingsCard,
  SettingsRow,
  SettingsSaveBar,
  SettingsStatusBadge,
  SettingsToggleRow,
  settingsInputClass,
} from './SettingsPrimitives';

interface OAuthServerSectionProps {
  highlightedSection?: string | null;
  onDirtyChange?: (sectionId: string, dirty: boolean) => void;
}

export const OAuthServerSection: React.FC<OAuthServerSectionProps> = ({
  highlightedSection,
  onDirtyChange,
}) => {
  const { t } = useTranslation();
  const { oauthServerConfig, initialLoading } = useRuntimeSettings();
  const { isSectionSaving, updateOAuthServerConfig, updateOAuthServerConfigBatch } =
    useSettingsActions();
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const remoteForm = useMemo(
    () => ({
      approvalLifetime: String(oauthServerConfig.approvalLifetime),
      accessTokenLifetime:
        oauthServerConfig.accessTokenLifetime !== undefined
          ? String(oauthServerConfig.accessTokenLifetime)
          : '',
      refreshTokenLifetime:
        oauthServerConfig.refreshTokenLifetime !== undefined
          ? String(oauthServerConfig.refreshTokenLifetime)
          : '',
      authorizationCodeLifetime:
        oauthServerConfig.authorizationCodeLifetime !== undefined
          ? String(oauthServerConfig.authorizationCodeLifetime)
          : '',
      allowedScopes:
        oauthServerConfig.allowedScopes && oauthServerConfig.allowedScopes.length > 0
          ? oauthServerConfig.allowedScopes.join(', ')
          : '',
      dynamicRegistrationAllowedGrantTypes: oauthServerConfig.dynamicRegistration
        ?.allowedGrantTypes?.length
        ? oauthServerConfig.dynamicRegistration.allowedGrantTypes.join(', ')
        : '',
      dynamicRegistrationClientTtl:
        oauthServerConfig.dynamicRegistration?.clientTtl !== undefined
          ? String(oauthServerConfig.dynamicRegistration.clientTtl)
          : '',
    }),
    [oauthServerConfig],
  );

  const draft = useSettingsDraft(remoteForm);
  const saving = isSectionSaving('oauthServer');

  useEffect(() => {
    onDirtyChange?.('oauth-server', draft.dirty);
    return () => onDirtyChange?.('oauth-server', false);
  }, [draft.dirty, onDirtyChange]);

  const setField = <K extends keyof typeof remoteForm>(key: K, value: string) => {
    setFieldErrors((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
    draft.setField(key, value);
  };

  const handleSave = async () => {
    const errors: Record<string, string> = {};
    const updates: Partial<OAuthServerConfig> = {};

    const parseNumber = (
      key: keyof typeof remoteForm,
      min: number,
      max?: number,
      customMsg?: string,
    ): number | null => {
      const raw = draft.values[key].trim();
      if (!raw) {
        errors[key] = customMsg || t('settings.invalidNumberInput') || 'Please enter a valid number';
        return null;
      }
      const parsed = Number(raw);
      if (
        !Number.isFinite(parsed) ||
        parsed < min ||
        (max !== undefined && (!Number.isSafeInteger(parsed) || parsed > max))
      ) {
        errors[key] = customMsg || t('settings.invalidNumberInput') || 'Please enter a valid number';
        return null;
      }
      return Math.floor(parsed);
    };

    if ('approvalLifetime' in draft.dirtyFields) {
      const val = parseNumber('approvalLifetime', 1, 31536000, t('oauthApprovals.invalidLifetime'));
      if (val !== null) updates.approvalLifetime = val;
    }
    if ('accessTokenLifetime' in draft.dirtyFields) {
      const val = parseNumber('accessTokenLifetime', 0);
      if (val !== null) updates.accessTokenLifetime = val;
    }
    if ('refreshTokenLifetime' in draft.dirtyFields) {
      const val = parseNumber('refreshTokenLifetime', 0);
      if (val !== null) updates.refreshTokenLifetime = val;
    }
    if ('authorizationCodeLifetime' in draft.dirtyFields) {
      const val = parseNumber('authorizationCodeLifetime', 0);
      if (val !== null) updates.authorizationCodeLifetime = val;
    }
    if ('allowedScopes' in draft.dirtyFields) {
      updates.allowedScopes = draft.values.allowedScopes
        .split(',')
        .map((scope) => scope.trim())
        .filter(Boolean);
    }

    const dynamicUpdates: Partial<OAuthServerConfig['dynamicRegistration']> = {};
    if ('dynamicRegistrationAllowedGrantTypes' in draft.dirtyFields) {
      dynamicUpdates.allowedGrantTypes = draft.values.dynamicRegistrationAllowedGrantTypes
        .split(',')
        .map((grant) => grant.trim())
        .filter(Boolean);
    }
    if ('dynamicRegistrationClientTtl' in draft.dirtyFields) {
      const val = parseNumber('dynamicRegistrationClientTtl', 0);
      if (val !== null) dynamicUpdates.clientTtl = val;
    }
    if (Object.keys(dynamicUpdates).length > 0) {
      updates.dynamicRegistration = {
        ...oauthServerConfig.dynamicRegistration,
        ...dynamicUpdates,
      };
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFieldErrors({});
    if (Object.keys(updates).length === 0) return;

    const ok = await updateOAuthServerConfigBatch(updates);
    if (ok) {
      draft.discard();
    }
  };

  const disabledAll = initialLoading || saving || !oauthServerConfig.enabled;
  const dynamicDisabled = disabledAll || !oauthServerConfig.dynamicRegistration.enabled;

  return (
    <PermissionChecker permissions={PERMISSIONS.SETTINGS_OAUTH_SERVER}>
      <SettingsCard
        id="oauth-server"
        title={t('pages.settings.oauthServer')}
        description={t('settings.enableOauthServerDescription')}
        icon={<Lock size={15} />}
        badge={<SettingsStatusBadge active={oauthServerConfig.enabled} />}
        dirty={draft.dirty}
        highlighted={highlightedSection === 'oauth-server'}
      >
        <div className="space-y-3">
          <SettingsToggleRow
            id="oauth-server-enabled"
            label={t('settings.enableOauthServer')}
            description={t('settings.enableOauthServerDescription')}
            checked={oauthServerConfig.enabled}
            disabled={initialLoading || saving}
            onCheckedChange={(checked) => void updateOAuthServerConfig('enabled', checked)}
          />

          <div className="grid gap-3 md:grid-cols-2">
            <SettingsToggleRow
              id="oauth-require-client-secret"
              label={t('settings.requireClientSecret')}
              description={t('settings.requireClientSecretDescription')}
              checked={oauthServerConfig.requireClientSecret}
              disabled={disabledAll}
              onCheckedChange={(checked) =>
                void updateOAuthServerConfig('requireClientSecret', checked)
              }
            />

            <SettingsToggleRow
              id="oauth-require-state"
              label={t('settings.requireState')}
              description={t('settings.requireStateDescription')}
              checked={oauthServerConfig.requireState}
              disabled={disabledAll}
              onCheckedChange={(checked) => void updateOAuthServerConfig('requireState', checked)}
            />
          </div>

          <SettingsToggleRow
            id="remember-oauth-consent"
            label={t('oauthApprovals.remember')}
            description={t('oauthApprovals.rememberDescription')}
            checked={!oauthServerConfig.alwaysShowApprovalScreen}
            disabled={disabledAll}
            onCheckedChange={(checked) =>
              void updateOAuthServerConfig('alwaysShowApprovalScreen', !checked)
            }
          />

          <div className="grid gap-3 md:grid-cols-2">
            <SettingsRow
              htmlFor="approval-lifetime"
              label={t('oauthApprovals.lifetime')}
              description={t('oauthApprovals.lifetimeDescription')}
              error={fieldErrors.approvalLifetime}
            >
              <input
                id="approval-lifetime"
                type="number"
                min="1"
                max="31536000"
                step="1"
                value={draft.values.approvalLifetime}
                disabled={disabledAll}
                onChange={(e) => setField('approvalLifetime', e.target.value)}
                className={settingsInputClass}
              />
            </SettingsRow>

            <SettingsRow
              htmlFor="access-token-lifetime"
              label={t('settings.accessTokenLifetime')}
              description={t('settings.accessTokenLifetimeDescription')}
              error={fieldErrors.accessTokenLifetime}
            >
              <input
                id="access-token-lifetime"
                type="number"
                min="0"
                value={draft.values.accessTokenLifetime}
                onChange={(e) => setField('accessTokenLifetime', e.target.value)}
                placeholder={t('settings.accessTokenLifetimePlaceholder')}
                className={settingsInputClass}
                disabled={disabledAll}
              />
            </SettingsRow>

            <SettingsRow
              htmlFor="refresh-token-lifetime"
              label={t('settings.refreshTokenLifetime')}
              description={t('settings.refreshTokenLifetimeDescription')}
              error={fieldErrors.refreshTokenLifetime}
            >
              <input
                id="refresh-token-lifetime"
                type="number"
                min="0"
                value={draft.values.refreshTokenLifetime}
                onChange={(e) => setField('refreshTokenLifetime', e.target.value)}
                placeholder={t('settings.refreshTokenLifetimePlaceholder')}
                className={settingsInputClass}
                disabled={disabledAll}
              />
            </SettingsRow>

            <SettingsRow
              htmlFor="auth-code-lifetime"
              label={t('settings.authorizationCodeLifetime')}
              description={t('settings.authorizationCodeLifetimeDescription')}
              error={fieldErrors.authorizationCodeLifetime}
            >
              <input
                id="auth-code-lifetime"
                type="number"
                min="0"
                value={draft.values.authorizationCodeLifetime}
                onChange={(e) => setField('authorizationCodeLifetime', e.target.value)}
                placeholder={t('settings.authorizationCodeLifetimePlaceholder')}
                className={settingsInputClass}
                disabled={disabledAll}
              />
            </SettingsRow>
          </div>

          <SettingsRow
            htmlFor="oauth-allowed-scopes"
            label={t('settings.allowedScopes')}
            description={t('settings.allowedScopesDescription')}
          >
            <input
              id="oauth-allowed-scopes"
              type="text"
              value={draft.values.allowedScopes}
              onChange={(e) => setField('allowedScopes', e.target.value)}
              placeholder={t('settings.allowedScopesPlaceholder')}
              className={`${settingsInputClass} mono`}
              disabled={disabledAll}
            />
          </SettingsRow>

          <div className="space-y-3 rounded-lg border border-[var(--hub-line)] bg-[var(--hub-surface)] p-3.5">
            <SettingsToggleRow
              id="oauth-dynamic-reg-enabled"
              label={t('settings.enableDynamicRegistration')}
              description={t('settings.dynamicRegistrationDescription')}
              checked={oauthServerConfig.dynamicRegistration.enabled}
              disabled={disabledAll}
              onCheckedChange={(checked) =>
                void updateOAuthServerConfig('dynamicRegistration', {
                  ...oauthServerConfig.dynamicRegistration,
                  enabled: checked,
                })
              }
            />

            <div className="grid gap-3 md:grid-cols-2">
              <SettingsRow
                htmlFor="oauth-dcr-grant-types"
                label={t('settings.dynamicRegistrationAllowedGrantTypes')}
                description={t('settings.dynamicRegistrationAllowedGrantTypesDescription')}
              >
                <input
                  id="oauth-dcr-grant-types"
                  type="text"
                  value={draft.values.dynamicRegistrationAllowedGrantTypes}
                  onChange={(e) =>
                    setField('dynamicRegistrationAllowedGrantTypes', e.target.value)
                  }
                  placeholder={t('settings.dynamicRegistrationAllowedGrantTypesPlaceholder')}
                  className={`${settingsInputClass} mono`}
                  disabled={dynamicDisabled}
                />
              </SettingsRow>

              <SettingsRow
                htmlFor="oauth-dcr-client-ttl"
                label={t('settings.dynamicRegistrationClientTtl')}
                description={t('settings.dynamicRegistrationClientTtlDescription')}
                error={fieldErrors.dynamicRegistrationClientTtl}
              >
                <input
                  id="oauth-dcr-client-ttl"
                  type="number"
                  min="0"
                  value={draft.values.dynamicRegistrationClientTtl}
                  onChange={(e) => setField('dynamicRegistrationClientTtl', e.target.value)}
                  placeholder={t('settings.dynamicRegistrationClientTtlPlaceholder')}
                  className={settingsInputClass}
                  disabled={dynamicDisabled}
                />
              </SettingsRow>
            </div>

            <SettingsToggleRow
              id="oauth-dcr-auth"
              label={t('settings.dynamicRegistrationAuth')}
              description={t('settings.dynamicRegistrationAuthDescription')}
              checked={oauthServerConfig.dynamicRegistration.requiresAuthentication}
              disabled={dynamicDisabled}
              onCheckedChange={(checked) =>
                void updateOAuthServerConfig('dynamicRegistration', {
                  ...oauthServerConfig.dynamicRegistration,
                  requiresAuthentication: checked,
                })
              }
            />
          </div>
        </div>

        <SettingsSaveBar
          dirty={draft.dirty}
          saving={saving}
          disabled={disabledAll}
          onSave={handleSave}
          onDiscard={() => {
            setFieldErrors({});
            draft.discard();
          }}
        />
      </SettingsCard>
    </PermissionChecker>
  );
};

export default OAuthServerSection;
