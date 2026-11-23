import React from 'react';
import { useTranslation } from 'react-i18next';
import { UserPlus } from 'lucide-react';
import { useRuntimeSettings, useSettingsActions } from '@/hooks/useSettingsData';
import { PermissionChecker } from '@/components/PermissionChecker';
import { PERMISSIONS } from '@/constants/permissions';
import { SettingsCard, SettingsStatusBadge, SettingsToggleRow } from './SettingsPrimitives';

interface UserRegistrationSectionProps {
  highlightedSection?: string | null;
}

export const UserRegistrationSection: React.FC<UserRegistrationSectionProps> = ({
  highlightedSection,
}) => {
  const { t } = useTranslation();
  const { allowRegistration, initialLoading } = useRuntimeSettings();
  const { isSectionSaving, updateAllowRegistration } = useSettingsActions();

  return (
    <PermissionChecker permissions={PERMISSIONS.SETTINGS_SYSTEM_CONFIG}>
      <SettingsCard
        id="registration"
        title={t('settings.allowRegistration')}
        description={t('settings.allowRegistrationDescription')}
        icon={<UserPlus size={15} />}
        badge={<SettingsStatusBadge active={allowRegistration} />}
        highlighted={highlightedSection === 'registration'}
      >
        <SettingsToggleRow
          id="allow-registration-toggle"
          label={t('settings.allowRegistration')}
          description={t('settings.allowRegistrationDescription')}
          checked={allowRegistration}
          disabled={initialLoading || isSectionSaving('allowRegistration')}
          onCheckedChange={(checked) => void updateAllowRegistration(checked)}
        />
      </SettingsCard>
    </PermissionChecker>
  );
};

export default UserRegistrationSection;
