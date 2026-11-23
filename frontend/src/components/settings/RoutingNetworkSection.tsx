import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Network, ShieldCheck } from 'lucide-react';
import { PermissionChecker } from '@/components/PermissionChecker';
import FakeIpExceptionsSettings from '@/components/FakeIpExceptionsSettings';
import { PERMISSIONS } from '@/constants/permissions';
import { useRuntimeSettings, useSettingsActions } from '@/hooks/useSettingsData';
import { useSettingsDraft } from '@/hooks/useSettingsDraft';
import type { Server } from '@/types';
import {
  SettingsCard,
  SettingsRow,
  SettingsSaveBar,
  SettingsToggleRow,
  settingsInputClass,
  settingsTextareaClass,
} from './SettingsPrimitives';

interface RoutingNetworkSectionProps {
  isAdmin: boolean;
  servers: Server[];
  highlightedSection?: string | null;
  onDirtyChange?: (sectionId: string, dirty: boolean) => void;
}

export const RoutingNetworkSection: React.FC<RoutingNetworkSectionProps> = ({
  isAdmin,
  servers,
  highlightedSection,
  onDirtyChange,
}) => {
  const { t } = useTranslation();
  const { routingConfig, allowedCidrs, fakeIpExceptions, initialLoading } = useRuntimeSettings();
  const {
    isSectionSaving,
    updateRoutingConfig,
    updateAllowedCidrs,
    updateFakeIpExceptions,
  } = useSettingsActions();

  const remoteRoute = useMemo(
    () => ({ jsonBodyLimit: routingConfig.jsonBodyLimit }),
    [routingConfig.jsonBodyLimit],
  );
  const routeDraft = useSettingsDraft(remoteRoute);

  const remoteCidrs = useMemo(
    () => ({ allowedCidrsText: allowedCidrs.join('\n') }),
    [allowedCidrs],
  );
  const cidrsDraft = useSettingsDraft(remoteCidrs);

  useEffect(() => {
    onDirtyChange?.('route-config', routeDraft.dirty);
    return () => onDirtyChange?.('route-config', false);
  }, [routeDraft.dirty, onDirtyChange]);

  useEffect(() => {
    onDirtyChange?.('network-security', cidrsDraft.dirty);
    return () => onDirtyChange?.('network-security', false);
  }, [cidrsDraft.dirty, onDirtyChange]);

  const savingRouting = isSectionSaving('routing');
  const savingCidrs = isSectionSaving('allowedCidrs');
  const savingFakeIp = isSectionSaving('fakeIpExceptions');
  const routingBusy = initialLoading || savingRouting;
  const cidrsBusy = initialLoading || savingCidrs;
  const fakeIpBusy = initialLoading || savingFakeIp;

  const handleSaveJsonBodyLimit = async () => {
    const ok = await updateRoutingConfig('jsonBodyLimit', routeDraft.values.jsonBodyLimit);
    if (ok) {
      routeDraft.discard();
    }
  };

  const handleSaveAllowedCidrs = async () => {
    const parsed = cidrsDraft.values.allowedCidrsText.split(/\s+/).filter(Boolean);
    const ok = await updateAllowedCidrs(parsed);
    if (ok) {
      cidrsDraft.discard();
    }
  };

  return (
    <div className="space-y-4">
      <PermissionChecker permissions={PERMISSIONS.SETTINGS_ROUTE_CONFIG}>
        <SettingsCard
          id="route-config"
          title={t('pages.settings.routeConfig')}
          description={t('settings.routeConfigSectionDescription')}
          icon={<ShieldCheck size={15} />}
          dirty={routeDraft.dirty}
          highlighted={highlightedSection === 'route-config'}
        >
          <div className="space-y-3">
            <SettingsToggleRow
              id="enable-global-route"
              label={t('settings.enableGlobalRoute')}
              description={t('settings.enableGlobalRouteDescription')}
              checked={routingConfig.enableGlobalRoute}
              disabled={routingBusy}
              onCheckedChange={(checked) => void updateRoutingConfig('enableGlobalRoute', checked)}
            />

            <SettingsToggleRow
              id="enable-group-name-route"
              label={t('settings.enableGroupNameRoute')}
              description={t('settings.enableGroupNameRouteDescription')}
              checked={routingConfig.enableGroupNameRoute}
              disabled={routingBusy}
              onCheckedChange={(checked) =>
                void updateRoutingConfig('enableGroupNameRoute', checked)
              }
            />

            <SettingsToggleRow
              id="skip-auth"
              label={t('settings.skipAuth')}
              description={t('settings.skipAuthDescription')}
              checked={routingConfig.skipAuth}
              disabled={routingBusy}
              onCheckedChange={(checked) => void updateRoutingConfig('skipAuth', checked)}
            />

            <SettingsRow
              htmlFor="json-body-limit"
              label={t('settings.jsonBodyLimit')}
              description={t('settings.jsonBodyLimitDescription')}
            >
              <input
                id="json-body-limit"
                type="text"
                value={routeDraft.values.jsonBodyLimit}
                onChange={(e) => routeDraft.setField('jsonBodyLimit', e.target.value)}
                placeholder={t('settings.jsonBodyLimitPlaceholder')}
                className={`${settingsInputClass} mono`}
                disabled={routingBusy}
              />
            </SettingsRow>
          </div>

          <SettingsSaveBar
            dirty={routeDraft.dirty}
            saving={savingRouting}
            disabled={initialLoading}
            onSave={handleSaveJsonBodyLimit}
            onDiscard={routeDraft.discard}
          />
        </SettingsCard>
      </PermissionChecker>

      {isAdmin && (
        <SettingsCard
          id="network-security"
          title={t('settings.networkSecurityTitle')}
          description={t('settings.networkSecurityDescription')}
          icon={<Network size={15} />}
          badge={
            allowedCidrs.length + fakeIpExceptions.length > 0 ? (
              <span className="hub-tag hub-num">
                {allowedCidrs.length + fakeIpExceptions.length}
              </span>
            ) : undefined
          }
          dirty={cidrsDraft.dirty}
          highlighted={highlightedSection === 'network-security'}
        >
          <SettingsRow
            htmlFor="allowed-cidrs"
            label={t('settings.allowedCidrs')}
            description={t('settings.allowedCidrsDescription')}
          >
            <textarea
              id="allowed-cidrs"
              value={cidrsDraft.values.allowedCidrsText}
              onChange={(event) => cidrsDraft.setField('allowedCidrsText', event.target.value)}
              placeholder={'192.168.1.0/24\nfd00::/64'}
              rows={4}
              disabled={cidrsBusy}
              className={`${settingsTextareaClass} hub-mono`}
            />
          </SettingsRow>

          <SettingsSaveBar
            dirty={cidrsDraft.dirty}
            saving={savingCidrs}
            disabled={initialLoading}
            onSave={handleSaveAllowedCidrs}
            onDiscard={cidrsDraft.discard}
          />

          <FakeIpExceptionsSettings
            value={fakeIpExceptions}
            servers={servers}
            loading={fakeIpBusy}
            onSave={updateFakeIpExceptions}
          />
        </SettingsCard>
      )}
    </div>
  );
};

export default RoutingNetworkSection;
