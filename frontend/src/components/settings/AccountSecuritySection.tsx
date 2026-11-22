import React from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ArrowUpRight, Fingerprint, KeyRound, ShieldCheck, Lock } from 'lucide-react';
import ChangePasswordForm from '@/components/ChangePasswordForm';
import { SettingsCard } from './SettingsPrimitives';

interface AccountSecuritySectionProps {
  highlightedSection?: string | null;
}

export const AccountSecuritySection: React.FC<AccountSecuritySectionProps> = ({
  highlightedSection,
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const handlePasswordChangeSuccess = () => {
    setTimeout(() => {
      navigate('/');
    }, 2000);
  };

  const quickLinks = [
    {
      path: '/passkeys',
      icon: <Fingerprint size={16} aria-hidden="true" />,
      title: t('passkeys.title'),
      description: t('passkeys.description'),
    },
    {
      path: '/oauth-applications',
      icon: <ShieldCheck size={16} aria-hidden="true" />,
      title: t('oauthApprovals.title'),
      description: t('oauthApprovals.description'),
    },
    {
      path: '/credentials',
      icon: <Lock size={16} aria-hidden="true" />,
      title: t('credentials.title'),
      description: t('settings.credentialsShortcutDescription'),
    },
  ];

  return (
    <div className="space-y-4">
      <SettingsCard
        id="password"
        title={t('auth.changePassword')}
        description={t('settings.changePasswordDescription')}
        icon={<KeyRound size={15} />}
        highlighted={highlightedSection === 'password'}
      >
        <ChangePasswordForm embedded onSuccess={handlePasswordChangeSuccess} />
      </SettingsCard>

      <SettingsCard
        id="account-security"
        title={t('settings.accountSecurityHubTitle')}
        description={t('settings.accountSecurityHubDescription')}
        icon={<ShieldCheck size={15} />}
        highlighted={highlightedSection === 'account-security'}
      >
        <div className="grid gap-3 md:grid-cols-3">
          {quickLinks.map((item) => (
            <button
              key={item.path}
              type="button"
              onClick={() => navigate(item.path)}
              className="group flex flex-col justify-between gap-3 rounded-lg border border-[var(--hub-line)] bg-[var(--hub-bg-2)] p-3.5 text-left transition-colors hover:border-[var(--hub-ink-3)] hover:bg-[var(--hub-surface-hover)]"
            >
              <div className="flex items-start justify-between gap-2">
                <span className="grid h-8 w-8 place-items-center rounded-md border border-[var(--hub-line)] bg-[var(--hub-surface)] text-[var(--hub-ink-2)]">
                  {item.icon}
                </span>
                <ArrowUpRight
                  size={14}
                  aria-hidden="true"
                  className="text-[var(--hub-ink-3)] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[var(--hub-ink)]"
                />
              </div>
              <div>
                <div className="text-[13px] font-medium text-[var(--hub-ink)]">{item.title}</div>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-[var(--hub-ink-3)]">
                  {item.description}
                </p>
              </div>
            </button>
          ))}
        </div>
      </SettingsCard>
    </div>
  );
};

export default AccountSecuritySection;
