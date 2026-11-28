import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ChevronsUpDown,
  Fingerprint,
  Info,
  KeyRound,
  Lock,
  LogOut,
  ShieldCheck,
  User,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import AboutDialog from './AboutDialog';
import SponsorDialog from './SponsorDialog';
import WeChatDialog from './WeChatDialog';
import WeChatIcon from '@/components/icons/WeChatIcon';
import DiscordIcon from '@/components/icons/DiscordIcon';
import SponsorIcon from '@/components/icons/SponsorIcon';
import { ChangelogUpdateInfo } from '@/types';
import {
  fetchChangelogUpdateInfo,
  shouldShowUpdateBadge,
} from '@/services/changelogService';
import {
  ACCOUNT_MENU_ITEMS,
  isAccountRoute,
  type NavIconId,
} from '@/utils/navigationRegistry';

interface UserProfileMenuProps {
  collapsed: boolean;
  version: string;
  onNavigate?: () => void;
}

const ACCOUNT_ICON_MAP: Partial<Record<NavIconId, React.ReactNode>> = {
  credentials: <Lock className="h-4 w-4 shrink-0" aria-hidden="true" />,
  passkeys: <Fingerprint className="h-4 w-4 shrink-0" aria-hidden="true" />,
  oauthApplications: <ShieldCheck className="h-4 w-4 shrink-0" aria-hidden="true" />,
  changePassword: <KeyRound className="h-4 w-4 shrink-0" aria-hidden="true" />,
};

const MENU_ITEM_CLASS =
  'flex items-center gap-2.5 w-full rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ' +
  'text-[var(--hub-ink-2)] hover:bg-[var(--hub-surface-hover)] hover:text-[var(--hub-ink)] ' +
  'focus:outline-none focus-visible:bg-[var(--hub-surface-hover)] focus-visible:text-[var(--hub-ink)]';

const UserProfileMenu: React.FC<UserProfileMenuProps> = ({ collapsed, version, onNavigate }) => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { auth, logout } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [showNewVersionInfo, setShowNewVersionInfo] = useState(false);
  const [showAboutDialog, setShowAboutDialog] = useState(false);
  const [sponsorDialogOpen, setSponsorDialogOpen] = useState(false);
  const [wechatDialogOpen, setWechatDialogOpen] = useState(false);
  const [updateInfo, setUpdateInfo] = useState<ChangelogUpdateInfo | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const accountRouteActive = isAccountRoute(location.pathname);
  const displayName = auth.user?.username || t('auth.user');
  const isChineseLocale = (i18n.resolvedLanguage || i18n.language || '').startsWith('zh');

  // Check for new version on login and component mount.
  useEffect(() => {
    const checkForNewVersion = async () => {
      try {
        const info = await fetchChangelogUpdateInfo({
          currentVersion: version,
          locale: i18n.language,
        });
        setUpdateInfo(info);
        setShowNewVersionInfo(shouldShowUpdateBadge(info));
      } catch (error) {
        console.error('Error checking for new version:', error);
      }
    };

    void checkForNewVersion();
  }, [version, i18n.language]);

  const closeMenu = useCallback((restoreFocus = false) => {
    setIsOpen(false);
    if (restoreFocus) {
      requestAnimationFrame(() => {
        triggerRef.current?.focus();
      });
    }
  }, []);

  // Close the menu when clicking outside or pressing Escape.
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, closeMenu]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
    if (!items || items.length === 0) return;

    const currentIndex = Array.from(items).indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      items[(currentIndex + 1) % items.length].focus();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      items[(currentIndex - 1 + items.length) % items.length].focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0].focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1].focus();
    }
  };

  const handleNavigate = (path: string) => {
    navigate(path);
    setIsOpen(false);
    onNavigate?.();
  };

  const handleLogoutClick = async () => {
    if (!(await logout())) return;
    setIsOpen(false);
    onNavigate?.();
    navigate('/login');
  };

  const handleAboutClick = () => {
    setShowAboutDialog(true);
    setIsOpen(false);
  };

  const handleSponsorClick = () => {
    setSponsorDialogOpen(true);
    setIsOpen(false);
  };

  const handleWeChatClick = () => {
    setWechatDialogOpen(true);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={displayName}
        title={collapsed ? displayName : undefined}
        className={[
          'flex w-full items-center rounded-md transition-colors',
          collapsed ? 'justify-center px-2 py-2' : 'gap-2.5 px-2 py-1.5',
          isOpen || accountRouteActive
            ? 'bg-[var(--hub-surface)] text-[var(--hub-ink)] ring-1 ring-inset ring-[var(--hub-line)]'
            : 'text-[var(--hub-ink-2)] hover:bg-[var(--hub-surface-hover)] hover:text-[var(--hub-ink)]',
        ].join(' ')}
      >
        <div className="relative flex-shrink-0">
          <div className="grid h-6 w-6 place-items-center rounded-full border border-[var(--hub-line)] bg-[var(--hub-surface)] text-[var(--hub-ink-2)]">
            <User className="h-3.5 w-3.5" aria-hidden="true" />
          </div>
          {showNewVersionInfo && (
            <span
              className="absolute -top-0.5 -right-0.5 block h-2 w-2 rounded-full ring-2 ring-[var(--hub-bg-2)]"
              style={{ background: 'var(--hub-err)' }}
            />
          )}
        </div>
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1 text-left">
              <div className="truncate text-[13px] font-medium leading-tight text-[var(--hub-ink)]">
                {displayName}
              </div>
              {auth.user?.isAdmin && (
                <div className="truncate text-[11px] leading-tight text-[var(--hub-ink-3)]">
                  {t('users.admin')}
                </div>
              )}
            </div>
            <ChevronsUpDown
              className="h-3.5 w-3.5 shrink-0 text-[var(--hub-ink-3)]"
              aria-hidden="true"
            />
          </>
        )}
      </button>

      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('nav.account')}
          onKeyDown={handleMenuKeyDown}
          className={[
            'absolute bottom-full left-0 mb-1.5 z-50 rounded-lg border border-[var(--hub-line)]',
            'bg-[var(--hub-surface)] p-1 shadow-lg',
            collapsed ? 'w-[220px]' : 'w-full min-w-[216px]',
          ].join(' ')}
        >
          {/* Account & Security */}
          <div className="hub-sect px-2.5 pt-1.5 pb-1">{t('nav.account')}</div>
          {ACCOUNT_MENU_ITEMS.map((item) => {
            const isItemActive = Boolean(
              item.matchPath &&
                (location.pathname === item.matchPath ||
                  location.pathname.startsWith(`${item.matchPath}/`)),
            );
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                aria-current={isItemActive ? 'page' : undefined}
                onClick={() => handleNavigate(item.path)}
                className={[
                  MENU_ITEM_CLASS,
                  isItemActive ? 'bg-[var(--hub-bg-2)] font-medium text-[var(--hub-ink)]' : '',
                ].join(' ')}
              >
                <span className={isItemActive ? 'text-[var(--hub-ink)]' : 'text-[var(--hub-ink-3)]'}>
                  {ACCOUNT_ICON_MAP[item.icon]}
                </span>
                <span className="truncate">{t(item.labelKey)}</span>
              </button>
            );
          })}

          <div className="my-1 border-t border-[var(--hub-line-2)]" role="separator" />

          {/* About & Community */}
          <button
            type="button"
            role="menuitem"
            onClick={handleAboutClick}
            className={MENU_ITEM_CLASS}
          >
            <Info className="h-4 w-4 shrink-0 text-[var(--hub-ink-3)]" aria-hidden="true" />
            <span className="truncate">{t('about.title')}</span>
            {showNewVersionInfo && (
              <span
                className="ml-auto block h-2 w-2 shrink-0 rounded-full"
                style={{ background: 'var(--hub-err)' }}
              />
            )}
          </button>

          <button
            type="button"
            role="menuitem"
            onClick={handleSponsorClick}
            className={MENU_ITEM_CLASS}
          >
            <SponsorIcon className="h-4 w-4 shrink-0 text-[var(--hub-ink-3)]" />
            <span className="truncate">{t('sponsor.label')}</span>
          </button>

          {isChineseLocale ? (
            <button
              type="button"
              role="menuitem"
              onClick={handleWeChatClick}
              className={MENU_ITEM_CLASS}
            >
              <WeChatIcon className="h-4 w-4 shrink-0 text-[var(--hub-ink-3)]" />
              <span className="truncate">{t('wechat.label')}</span>
            </button>
          ) : (
            <a
              href="https://discord.gg/2BJehJZVH5"
              target="_blank"
              rel="noopener noreferrer"
              role="menuitem"
              onClick={() => setIsOpen(false)}
              className={MENU_ITEM_CLASS}
            >
              <DiscordIcon className="h-4 w-4 shrink-0 text-[var(--hub-ink-3)]" />
              <span className="truncate">{t('discord.label')}</span>
            </a>
          )}

          <div className="my-1 border-t border-[var(--hub-line-2)]" role="separator" />

          {/* Session */}
          <button
            type="button"
            role="menuitem"
            onClick={handleLogoutClick}
            className={
              'flex items-center gap-2.5 w-full rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors ' +
              'text-[var(--hub-ink-2)] hover:bg-[var(--hub-surface-hover)] hover:text-[var(--hub-err)] ' +
              'focus:outline-none focus-visible:bg-[var(--hub-surface-hover)] focus-visible:text-[var(--hub-err)]'
            }
          >
            <LogOut className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{t('app.logout')}</span>
          </button>
        </div>
      )}

      {/* About dialog */}
      <AboutDialog
        isOpen={showAboutDialog}
        onClose={() => setShowAboutDialog(false)}
        version={version}
        initialUpdateInfo={updateInfo}
        onUpdateInfoChange={(info) => {
          setUpdateInfo(info);
          setShowNewVersionInfo(shouldShowUpdateBadge(info));
        }}
        onDismissUpdate={() => {
          setShowNewVersionInfo(false);
        }}
      />

      {/* Sponsor dialog */}
      <SponsorDialog open={sponsorDialogOpen} onOpenChange={setSponsorDialogOpen} />

      {/* WeChat dialog */}
      <WeChatDialog open={wechatDialogOpen} onOpenChange={setWechatDialogOpen} />
    </div>
  );
};

export default UserProfileMenu;
