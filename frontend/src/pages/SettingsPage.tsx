import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import {
  Cpu,
  KeyRound,
  Package,
  Search,
  Shield,
  SlidersHorizontal,
  UserCheck,
  X,
} from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useServerContext } from '@/contexts/ServerContext';
import { useGroupData } from '@/hooks/useGroupData';
import { useRuntimeSettings, useSettingsActions } from '@/hooks/useSettingsData';
import { apiGet } from '@/utils/fetchInterceptor';
import { cn } from '@/utils/cn';
import type { User } from '@/types';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import ToolPolicyPanel from '@/components/ToolPolicyPanel';
import {
  getVisibleCategories,
  resolveInitialCategoryAndSection,
  searchSettingsSections,
  type SettingsCategoryId,
  type SettingsSectionId,
} from '@/components/settings/settingsRegistry';
import GeneralSettingsSection from '@/components/settings/GeneralSettingsSection';
import BearerKeysSection from '@/components/settings/BearerKeysSection';
import OAuthServerSection from '@/components/settings/OAuthServerSection';
import BetterAuthSection from '@/components/settings/BetterAuthSection';
import UserRegistrationSection from '@/components/settings/UserRegistrationSection';
import RoutingNetworkSection from '@/components/settings/RoutingNetworkSection';
import SmartRoutingSection from '@/components/settings/SmartRoutingSection';
import ToolResultCompressionSection from '@/components/settings/ToolResultCompressionSection';
import FileStagingSection from '@/components/settings/FileStagingSection';
import InstallMaintenanceSection from '@/components/settings/InstallMaintenanceSection';
import AccountSecuritySection from '@/components/settings/AccountSecuritySection';

const CATEGORY_ICONS: Record<SettingsCategoryId, React.ReactNode> = {
  general: <SlidersHorizontal size={15} aria-hidden="true" />,
  access: <KeyRound size={15} aria-hidden="true" />,
  routing: <Shield size={15} aria-hidden="true" />,
  intelligence: <Cpu size={15} aria-hidden="true" />,
  environment: <Package size={15} aria-hidden="true" />,
  account: <UserCheck size={15} aria-hidden="true" />,
};

const SettingsPage: React.FC = () => {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { auth } = useAuth();
  const { allServers: servers } = useServerContext();
  const { groups } = useGroupData({ refreshOnMount: true });
  const {
    toolPolicies,
    nameSeparator,
    initialLoading,
    error: settingsError,
  } = useRuntimeSettings();
  const {
    bearerKeys,
    isSectionSaving,
    fetchSettings,
    updateToolPolicies,
    refreshBearerKeys,
  } = useSettingsActions();

  const isAdmin = auth.user?.isAdmin === true;
  const userPermissions = useMemo(() => auth.user?.permissions || [], [auth.user?.permissions]);
  const access = useMemo(
    () => ({ isAdmin, permissions: userPermissions }),
    [isAdmin, userPermissions],
  );

  const visibleCategories = useMemo(() => getVisibleCategories(access), [access]);

  const categoryParam = searchParams.get('category');
  const sectionParam = searchParams.get('section');
  const resolved = useMemo(
    () => resolveInitialCategoryAndSection(categoryParam, sectionParam, access),
    [categoryParam, sectionParam, access],
  );

  const [activeCategory, setActiveCategory] = useState<SettingsCategoryId>(resolved.category);
  const [highlightedSection, setHighlightedSection] = useState<SettingsSectionId | null>(
    resolved.section,
  );
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [dirtySections, setDirtySections] = useState<Record<string, boolean>>({});
  const [pendingNav, setPendingNav] = useState<{
    category: SettingsCategoryId;
    section: SettingsSectionId | null;
  } | null>(null);

  const hasDirtyChanges = useMemo(
    () => Object.values(dirtySections).some(Boolean),
    [dirtySections],
  );

  const handleDirtyChange = useCallback((sectionId: string, dirty: boolean) => {
    setDirtySections((prev) => {
      if (Boolean(prev[sectionId]) === dirty) return prev;
      return { ...prev, [sectionId]: dirty };
    });
  }, []);

  // Sync URL query parameters (e.g., from DefaultPasswordWarningModal or deep links)
  useEffect(() => {
    setActiveCategory(resolved.category);
    if (resolved.section) {
      setHighlightedSection(resolved.section);
    }
  }, [resolved.category, resolved.section]);

  // Scroll to deep-linked / search-selected section
  useEffect(() => {
    if (!highlightedSection) return;
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(highlightedSection);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
    const timer = window.setTimeout(() => {
      setHighlightedSection((current) => (current === highlightedSection ? null : current));
    }, 2400);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [highlightedSection, activeCategory]);

  // Warn before browser refresh/close when unsaved changes exist
  useEffect(() => {
    if (!hasDirtyChanges) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasDirtyChanges]);

  useEffect(() => {
    void refreshBearerKeys();
  }, [refreshBearerKeys]);

  useEffect(() => {
    if (!isAdmin) return;
    void apiGet<{ success: boolean; data?: User[] }>('/users').then((result) => {
      if (result.success && Array.isArray(result.data)) {
        setUsers(result.data);
      }
    });
  }, [isAdmin]);

  const commitNavigation = useCallback(
    (category: SettingsCategoryId, section: SettingsSectionId | null) => {
      setDirtySections({});
      setActiveCategory(category);
      setHighlightedSection(section);
      const nextParams = new URLSearchParams();
      nextParams.set('category', category);
      if (section) {
        nextParams.set('section', section);
      }
      setSearchParams(nextParams, { replace: true });
    },
    [setSearchParams],
  );

  const requestNavigation = useCallback(
    (category: SettingsCategoryId, section: SettingsSectionId | null = null) => {
      if (category === activeCategory) {
        if (section) {
          setHighlightedSection(section);
          const nextParams = new URLSearchParams();
          nextParams.set('category', category);
          nextParams.set('section', section);
          setSearchParams(nextParams, { replace: true });
        }
        return;
      }

      if (hasDirtyChanges) {
        setPendingNav({ category, section });
        return;
      }
      commitNavigation(category, section);
    },
    [activeCategory, hasDirtyChanges, commitNavigation, setSearchParams],
  );

  const searchResults = useMemo(
    () => searchSettingsSections(searchQuery, access, t),
    [searchQuery, access, t],
  );

  const activeCategoryMeta = visibleCategories.find((cat) => cat.id === activeCategory);

  const handleSelectSearchResult = (category: SettingsCategoryId, section: SettingsSectionId) => {
    setSearchQuery('');
    requestNavigation(category, section);
  };

  return (
    <div className="space-y-5">
      {/* Header + Search */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="hub-h1">{t('pages.settings.title')}</h1>
          <p className="hub-sub">{t('settings.subtitle') || ''}</p>
        </div>

        <div className="relative w-full sm:w-72">
          <Search
            size={14}
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--hub-ink-3)]"
          />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('settings.searchPlaceholder')}
            aria-label={t('settings.searchPlaceholder')}
            className="hub-input"
            style={{ paddingLeft: 32, paddingRight: 28 }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label={t('common.clear') || 'Clear'}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--hub-ink-3)] hover:text-[var(--hub-ink)]"
            >
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      {/* Cross-category search results */}
      {searchQuery.trim() && (
        <div className="hub-card p-3" role="region" aria-label={t('settings.searchResultsHeading')}>
          <div className="mb-2 flex items-center justify-between px-1">
            <span className="hub-sect">{t('settings.searchResultsHeading')}</span>
            <span className="hub-mono text-[11px] text-[var(--hub-ink-3)]">
              {searchResults.length}
            </span>
          </div>
          {searchResults.length === 0 ? (
            <p className="px-1 py-3 text-xs text-[var(--hub-ink-3)]">
              {t('settings.searchNoResults')}
            </p>
          ) : (
            <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {searchResults.map((section) => {
                const cat = visibleCategories.find((c) => c.id === section.category);
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => handleSelectSearchResult(section.category, section.id)}
                    className="flex flex-col items-start gap-0.5 rounded-lg border border-[var(--hub-line)] bg-[var(--hub-bg-2)] px-3 py-2 text-left transition-colors hover:border-[var(--hub-ink-3)] hover:bg-[var(--hub-surface-hover)]"
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium text-[var(--hub-ink)]">
                        {t(section.titleKey)}
                      </span>
                      {cat && <span className="hub-tag shrink-0">{t(cat.titleKey)}</span>}
                    </div>
                    <span className="line-clamp-1 text-xs text-[var(--hub-ink-3)]">
                      {t(section.descriptionKey)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Mobile horizontal category tabs */}
      <nav
        aria-label={t('pages.settings.title')}
        className="flex gap-1.5 overflow-x-auto pb-1 lg:hidden"
      >
        {visibleCategories.map((cat) => {
          const active = cat.id === activeCategory;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => requestNavigation(cat.id)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                active
                  ? 'border-[var(--hub-line)] bg-[var(--hub-surface)] text-[var(--hub-ink)]'
                  : 'border-transparent text-[var(--hub-ink-2)] hover:bg-[var(--hub-surface-hover)]',
              )}
            >
              {CATEGORY_ICONS[cat.id]}
              <span>{t(cat.titleKey)}</span>
            </button>
          );
        })}
      </nav>

      {/* Main 2-column layout: sticky left category nav + right content panels */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[232px_minmax(0,1fr)]">
        <aside className="sticky top-6 hidden lg:block">
          <nav
            aria-label={t('pages.settings.title')}
            className="hub-card flex flex-col gap-0.5 p-1.5"
          >
            {visibleCategories.map((cat) => {
              const active = cat.id === activeCategory;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => requestNavigation(cat.id)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13px] transition-colors',
                    active
                      ? 'bg-[var(--hub-bg-2)] font-medium text-[var(--hub-ink)] ring-1 ring-inset ring-[var(--hub-line)]'
                      : 'text-[var(--hub-ink-2)] hover:bg-[var(--hub-surface-hover)] hover:text-[var(--hub-ink)]',
                  )}
                >
                  <span
                    className={
                      active ? 'text-[var(--hub-ink)]' : 'text-[var(--hub-ink-3)]'
                    }
                  >
                    {CATEGORY_ICONS[cat.id]}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{t(cat.titleKey)}</span>
                  {active && hasDirtyChanges && (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full bg-[var(--hub-accent)]"
                      title={t('settings.unsavedBadge')}
                    />
                  )}
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 space-y-4">
          {activeCategoryMeta && (
            <div className="border-b border-[var(--hub-line-2)] pb-3">
              <h2 className="text-[15px] font-semibold text-[var(--hub-ink)]">
                {t(activeCategoryMeta.titleKey)}
              </h2>
              <p className="mt-0.5 text-xs text-[var(--hub-ink-3)]">
                {t(activeCategoryMeta.descriptionKey)}
              </p>
            </div>
          )}

          {activeCategory === 'general' && (
            <GeneralSettingsSection
              highlightedSection={highlightedSection}
              onDirtyChange={handleDirtyChange}
            />
          )}

          {activeCategory === 'access' && (
            <div className="space-y-4">
              <BearerKeysSection
                isAdmin={isAdmin}
                users={users}
                servers={servers}
                groups={groups}
                highlightedSection={highlightedSection}
                onDirtyChange={handleDirtyChange}
              />
              <OAuthServerSection
                highlightedSection={highlightedSection}
                onDirtyChange={handleDirtyChange}
              />
              <BetterAuthSection
                highlightedSection={highlightedSection}
                onDirtyChange={handleDirtyChange}
              />
              <UserRegistrationSection highlightedSection={highlightedSection} />
            </div>
          )}

          {activeCategory === 'routing' && (
            <div className="space-y-4">
              <RoutingNetworkSection
                isAdmin={isAdmin}
                servers={servers}
                highlightedSection={highlightedSection}
                onDirtyChange={handleDirtyChange}
              />
              {isAdmin && (
                <ToolPolicyPanel
                  defaultOpen
                  sectionId="tool-policies"
                  highlighted={highlightedSection === 'tool-policies'}
                  onDirtyChange={(dirty) => handleDirtyChange('tool-policies', dirty)}
                  nameSeparator={nameSeparator}
                  rules={toolPolicies}
                  loading={initialLoading || isSectionSaving('toolPolicies')}
                  loadError={settingsError}
                  onRetry={fetchSettings}
                  onSave={updateToolPolicies}
                  users={users}
                  bearerKeys={bearerKeys}
                  servers={servers}
                  groups={groups}
                />
              )}
            </div>
          )}

          {activeCategory === 'intelligence' && (
            <div className="space-y-4">
              <SmartRoutingSection
                highlightedSection={highlightedSection}
                onDirtyChange={handleDirtyChange}
              />
              <ToolResultCompressionSection
                highlightedSection={highlightedSection}
                onDirtyChange={handleDirtyChange}
              />
              <FileStagingSection
                highlightedSection={highlightedSection}
                onDirtyChange={handleDirtyChange}
              />
            </div>
          )}

          {activeCategory === 'environment' && (
            <InstallMaintenanceSection
              highlightedSection={highlightedSection}
              onDirtyChange={handleDirtyChange}
            />
          )}

          {activeCategory === 'account' && (
            <AccountSecuritySection highlightedSection={highlightedSection} />
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={pendingNav !== null}
        onClose={() => setPendingNav(null)}
        onConfirm={() => {
          if (pendingNav) {
            const target = pendingNav;
            setPendingNav(null);
            commitNavigation(target.category, target.section);
          }
        }}
        title={t('settings.unsavedLeaveTitle')}
        message={t('settings.unsavedLeaveMessage')}
        confirmText={t('settings.discardAndLeave')}
        variant="warning"
      />
    </div>
  );
};

export default SettingsPage;
