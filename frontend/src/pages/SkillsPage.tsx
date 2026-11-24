import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Compass,
  FileText,
  Plus,
  RefreshCw,
  Search,
  Settings2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import SkillFileBrowser from '@/components/SkillFileBrowser';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useGroupData } from '@/hooks/useGroupData';
import { useRuntimeSettings, useSettingsActions } from '@/hooks/useSettingsData';
import type { ApiResponse } from '@/types';
import { apiDelete, apiGet, apiPut, apiRequest } from '@/utils/fetchInterceptor';
import type {
  HostedSkill,
  SkillPublication,
  SkillSearchResult,
} from '../../../src/types/hostedSkill';

const readBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',', 2)[1]);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

async function prepareUpload(files: File[]) {
  if (
    !files.length ||
    files.length > 512 ||
    files.reduce((sum, file) => sum + file.size, 0) > 16 * 1024 * 1024
  ) {
    return;
  }
  const directory = files[0].webkitRelativePath.split('/')[0];
  if (!directory || files.some((file) => !file.webkitRelativePath.startsWith(directory + '/'))) {
    return;
  }
  const entries = await Promise.all(
    files.map(async (file) => ({
      path: file.webkitRelativePath.slice(directory.length + 1),
      base64: await readBase64(file),
    })),
  );
  const body = new FormData();
  body.append(
    'directory',
    new Blob([JSON.stringify({ directory, files: entries })], {
      type: 'application/json',
    }),
    'skill.json',
  );
  return body;
}

type SkillImport = { catalogUrl?: string };

function SkillImportDialog({
  target,
  onClose,
  onImported,
}: {
  target: SkillImport;
  onClose: () => void;
  onImported: (skill: HostedSkill) => void;
}) {
  const { t } = useTranslation();
  const { catalogUrl } = target;
  const [source, setSource] = useState<HostedSkill['source']['type']>(
    catalogUrl ? 'skills-sh' : 'directory',
  );
  const [url, setUrl] = useState(catalogUrl ?? '');
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);

  useLayoutEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      let response: ApiResponse<HostedSkill>;
      if (source === 'directory') {
        const body = await prepareUpload(files);
        if (!body) {
          setError(t('skills.invalidDirectory'));
          return;
        }
        response = await apiRequest('/skills', { method: 'POST', body });
      } else {
        response = await apiRequest('/skills', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: url.trim() }),
        });
      }
      if (response.success && response.data) onImported(response.data);
      else setError(response.message || t('skills.requestFailed'));
    } catch {
      setError(t('skills.requestFailed'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="skill-import-title"
      className="hub-card hub-card-pad fixed inset-0 m-auto max-h-[calc(100%-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-auto text-[var(--hub-ink)] shadow-xl backdrop:bg-black/50"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form onSubmit={submit} aria-busy={busy}>
        <h2 id="skill-import-title" className="hub-h1 mb-4!">
          {t('skills.import')}
        </h2>
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          {!catalogUrl && (
            <label className="flex flex-col gap-1">
              <span className="hub-sect">{t('skills.source')}</span>
              <select
                className="hub-input"
                value={source}
                onChange={(event) => {
                  setSource(event.target.value as HostedSkill['source']['type']);
                  setFiles([]);
                  setUrl('');
                  setError('');
                }}
              >
                <option value="directory">{t('skills.directory')}</option>
                <option value="github">GitHub</option>
                <option value="skills-sh">skills.sh</option>
              </select>
            </label>
          )}
          {source === 'directory' ? (
            <label className="flex flex-col gap-1">
              <span className="hub-sect">{t('skills.directory')}</span>
              <input
                className="hub-input w-full min-w-0 cursor-pointer pl-0! file:mr-2.5 file:h-full file:cursor-pointer file:border-r file:border-[var(--hub-line)] file:bg-[var(--hub-bg-2)] file:px-2.5 file:font-medium file:text-[var(--hub-ink)]"
                ref={(input) => {
                  input?.setAttribute('webkitdirectory', '');
                }}
                type="file"
                multiple
                required
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
            </label>
          ) : (
            <>
              <label className="flex flex-col gap-1">
                <span className="hub-sect">
                  {source === 'github' ? t('skills.githubUrl') : t('skills.catalogUrl')}
                </span>
                <input
                  className="hub-input w-full"
                  type="url"
                  required
                  readOnly={!!catalogUrl}
                  value={url}
                  placeholder={
                    source === 'github'
                      ? 'https://github.com/owner/repo/tree/main/skill-name'
                      : 'https://skills.sh/owner/repo/skill-name'
                  }
                  onChange={(event) => setUrl(event.target.value)}
                />
              </label>
            </>
          )}
        </fieldset>
        {error && (
          <p className="mt-4 text-[13px] text-[var(--hub-err)]" role="alert">
            {error}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button className="hub-btn" type="button" disabled={busy} onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button className="hub-btn primary" type="submit" disabled={busy}>
            {busy ? t('app.loading') : t('skills.import')}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function SkillProxySettings({ hidden }: { hidden: boolean }) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { skillImportProxy, initialLoading: loading } = useRuntimeSettings();
  const { fetchSettings } = useSettingsActions();
  const [proxyMode, setProxyMode] = useState('server');
  const [proxyAddress, setProxyAddress] = useState('');
  const [savingSkillProxy, setSavingSkillProxy] = useState(false);
  useEffect(() => {
    const custom = skillImportProxy !== 'direct' && skillImportProxy !== 'server';
    setProxyMode(custom ? 'custom' : skillImportProxy);
    setProxyAddress(custom ? skillImportProxy : '');
  }, [skillImportProxy]);

  const saveSkillProxy = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSavingSkillProxy(true);
    try {
      const result = await apiPut('/system-config', {
        install: { skillImportProxy: proxyMode === 'custom' ? proxyAddress.trim() : proxyMode },
      });
      if (!result.success) throw new Error(result.message || result.error);
      await fetchSettings();
      showToast(t('settings.systemConfigUpdated'));
    } catch (error) {
      showToast(error instanceof Error ? error.message : t('skills.proxySaveFailed'), 'error');
    } finally {
      setSavingSkillProxy(false);
    }
  };

  return (
    <section
      id="skills-panel-configuration"
      role="tabpanel"
      aria-labelledby="skills-tab-configuration"
      hidden={hidden}
      className="hub-card skill-toolbar max-w-3xl"
    >
      <div className="mb-5 flex items-start gap-3">
        <span className="skill-emblem size-9">
          <Settings2 size={18} aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-base font-semibold">{t('skills.proxySettings')}</h2>
          <p className="skill-description">{t('skills.proxyHelp')}</p>
        </div>
      </div>
      <form onSubmit={saveSkillProxy} className="space-y-4">
        <fieldset disabled={loading || savingSkillProxy}>
          <legend className="hub-sect mb-2">{t('skills.proxyMode')}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {(['server', 'direct', 'custom'] as const).map((mode) => (
              <label key={mode} className="skill-proxy-option">
                <input
                  type="radio"
                  name="skill-proxy"
                  value={mode}
                  checked={proxyMode === mode}
                  onChange={() => setProxyMode(mode)}
                />
                {t(`skills.proxy${{ server: 'Server', direct: 'Direct', custom: 'Custom' }[mode]}`)}
              </label>
            ))}
          </div>
        </fieldset>
        {proxyMode === 'custom' && (
          <label className="block text-sm">
            {t('skills.proxyAddress')}
            <input
              className="hub-input mt-1 block w-full"
              type="text"
              spellCheck={false}
              autoComplete="off"
              value={proxyAddress}
              onChange={(event) => setProxyAddress(event.target.value)}
              placeholder="http://proxy.example.com:8080"
              maxLength={2048}
              disabled={loading || savingSkillProxy}
              required
            />
          </label>
        )}
        <button type="submit" className="hub-btn primary" disabled={loading || savingSkillProxy}>
          {t('common.save')}
        </button>
      </form>
    </section>
  );
}

const tabs = ['installed', 'discover', 'configuration'] as const;
const tabIcons = { installed: BookOpen, discover: Compass, configuration: Settings2 };

function SkillManager() {
  const [searchParams] = useSearchParams();
  const id = searchParams.get('skill');
  const navigate = useNavigate();
  const [revision, setRevision] = useState(0);
  const { t, i18n } = useTranslation();
  const { groups, loading: groupsLoading, error: groupsError } = useGroupData({
    refreshOnMount: true,
  });
  const [skills, setSkills] = useState<HostedSkill[]>([]);
  const selected = skills.find((skill) => skill.id === id);
  const importedUrls = new Set(
    skills.flatMap(({ source }) => (source.type === 'skills-sh' ? [source.url] : [])),
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<(typeof tabs)[number]>('installed');
  const [installedQuery, setInstalledQuery] = useState('');
  const installedTerm = installedQuery.trim().toLowerCase();
  const visibleSkills = skills.filter(({ name, description }) =>
    `${name} ${description}`.toLowerCase().includes(installedTerm),
  );
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [results, setResults] = useState<SkillSearchResult[]>();
  const [importTarget, setImportTarget] = useState<SkillImport>();
  const [removal, setRemoval] = useState<HostedSkill>();

  useEffect(() => {
    let active = true;
    void apiGet<ApiResponse<HostedSkill[]>>('/skills').then((response) => {
      if (!active) return;
      if (response.success && response.data) setSkills(response.data);
      else setError(response.message || t('skills.requestFailed'));
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [revision, t]);

  const run = async (
    action: () => Promise<ApiResponse>,
    onSuccess: (data: HostedSkill) => void,
  ) => {
    setError('');
    setBusy(true);
    try {
      const result = await action();
      if (result.success) {
        onSuccess(result.data);
        return true;
      }
      setError(result.message || t('skills.requestFailed'));
    } catch {
      setError(t('skills.requestFailed'));
    } finally {
      setBusy(false);
    }
    return false;
  };

  const replaceSkill = (skill: HostedSkill) =>
    setSkills((current) => current.map((entry) => (entry.id === skill.id ? skill : entry)));

  const search = async (query: string) => {
    if (searching) return;
    setSearching(true);
    setSearchError('');
    setResults(undefined);
    try {
      const response = await apiGet<ApiResponse<SkillSearchResult[]>>(
        query ? `/skills/discover?q=${encodeURIComponent(query)}` : '/skills/discover',
      );
      if (response.success && response.data) setResults(response.data);
      else setSearchError(response.message || t('skills.requestFailed'));
    } catch {
      setSearchError(t('skills.requestFailed'));
    } finally {
      setSearching(false);
    }
  };

  const openTab = (next: (typeof tabs)[number]) => {
    setTab(next);
    if (next === 'discover' && !results && !searchError) void search('');
  };

  const publish = async (form: HTMLFormElement, skillId: string) => {
    if (busy || loading) return;
    const fields = new FormData(form);
    const publication: SkillPublication = {
      enabled: fields.has('enabled'),
      global: fields.has('global'),
      groupIds: fields.getAll('group').map(String),
    };
    const saved = await run(() => apiPut(`/skills/${skillId}`, publication), replaceSkill);
    if (!saved) form.reset();
  };

  const refresh = () => {
    setLoading(true);
    setError('');
    setRevision((current) => current + 1);
  };

  const catalog = (
    <>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <h1 className="hub-h1">{t('skills.title')}</h1>
        <button
          type="button"
          className="hub-btn primary"
          disabled={busy || loading}
          onClick={() => setImportTarget({})}
        >
          <Plus size={14} aria-hidden="true" />
          {t('skills.manualImport')}
        </button>
      </header>
      <div
        className="skill-tabs mb-5 flex flex-wrap gap-1"
        role="tablist"
        aria-label={t('skills.title')}
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next =
            event.key === 'Home' || event.key === 'End'
              ? tabs[event.key === 'Home' ? 0 : tabs.length - 1]
              : tabs[
                  (tabs.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) %
                    tabs.length
                ];
          document.getElementById(`skills-tab-${next}`)?.focus();
          openTab(next);
        }}
      >
        {tabs.map((item) => {
          const Icon = tabIcons[item];
          return (
            <button
              key={item}
              id={`skills-tab-${item}`}
              type="button"
              role="tab"
              aria-controls={`skills-panel-${item}`}
              aria-selected={tab === item}
              tabIndex={tab === item ? 0 : -1}
              className="skill-tab"
              onClick={() => openTab(item)}
            >
              <Icon size={16} aria-hidden="true" />
              {t(`skills.${item}`)}
              {item === 'installed' && !loading && (
                <span className="skill-count">{skills.length}</span>
              )}
            </button>
          );
        })}
      </div>
      <SkillProxySettings hidden={tab !== 'configuration'} />
      <section
        id="skills-panel-discover"
        role="tabpanel"
        aria-labelledby="skills-tab-discover"
        hidden={tab !== 'discover'}
        className="space-y-4"
      >
        <form
          className="hub-card skill-toolbar flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void search(query.trim());
          }}
        >
          <label className="flex min-w-0 grow basis-56 flex-col gap-1">
            <span className="hub-sect">{t('skills.searchCatalog')}</span>
            <span className="skill-search">
              <Search size={16} aria-hidden="true" />
              <input
                className="hub-input w-full"
                type="search"
                value={query}
                maxLength={100}
                onChange={(event) => setQuery(event.target.value)}
              />
            </span>
          </label>
          <button
            type="submit"
            className="hub-btn"
            disabled={searching || query.trim().length === 1}
          >
            {t('common.search')}
          </button>
        </form>
        {searching && (
          <p className="hub-sub" role="status">
            {t('app.loading')}
          </p>
        )}
        {searchError && (
          <p className="text-[13px] text-[var(--hub-err)]" role="alert">
            {searchError}
          </p>
        )}
        {results?.length === 0 && (
          <p className="hub-sub" role="status">
            {t('skills.noResults')}
          </p>
        )}
        {!!results?.length && (
          <ul className="skill-grid">
            {results.map((result) => (
              <li key={result.url} className="hub-card skill-tile">
                <div className="min-w-0">
                  <a
                    className="inline-flex items-center gap-1 text-base font-semibold [overflow-wrap:anywhere] hover:underline"
                    href={result.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {result.name}
                    <ArrowUpRight size={14} className="shrink-0" aria-hidden="true" />
                  </a>
                  <p className="hub-sub [overflow-wrap:anywhere]">{result.source}</p>
                </div>
                <div className="hub-border-t mt-auto flex flex-wrap items-center justify-between gap-2 pt-3">
                  {result.installs !== null && (
                    <span className="text-xs text-[var(--hub-ink-2)] tabular-nums">
                      {t('skills.installCount', {
                        count: result.installs,
                        formatted: result.installs.toLocaleString(i18n.language),
                      })}
                    </span>
                  )}
                  <button
                    type="button"
                    className="hub-btn ms-auto"
                    disabled={busy || loading || importedUrls.has(result.url)}
                    aria-label={`${t(importedUrls.has(result.url) ? 'skills.imported' : 'skills.import')} ${result.name} (${result.source})`}
                    onClick={() => setImportTarget({ catalogUrl: result.url })}
                  >
                    {t(importedUrls.has(result.url) ? 'skills.imported' : 'skills.import')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div
        id="skills-panel-installed"
        role="tabpanel"
        aria-labelledby="skills-tab-installed"
        hidden={tab !== 'installed'}
      >
        {error && (
          <p className="mb-4 text-[13px] text-[var(--hub-err)]" role="alert">
            {error}
          </p>
        )}
        {loading && (
          <p
            className="hub-card p-10 text-center text-[13px] text-[var(--hub-ink-3)]"
            role="status"
          >
            {t('app.loading')}
          </p>
        )}
        {!loading && skills.length > 0 && (
          <label className="skill-search mb-4 flex max-w-sm">
            <span className="sr-only">{t('skills.searchInstalled')}</span>
            <Search size={16} aria-hidden="true" />
            <input
              className="hub-input w-full"
              type="search"
              placeholder={t('skills.searchInstalled')}
              value={installedQuery}
              onChange={(event) => setInstalledQuery(event.target.value)}
            />
          </label>
        )}
        {!loading && !visibleSkills.length && !error && (
          <div className="hub-card skill-empty">
            <span className="skill-emblem size-10">
              <BookOpen size={19} aria-hidden="true" />
            </span>
            <p role="status">{t(skills.length ? 'skills.noResults' : 'skills.empty')}</p>
            {!skills.length && (
              <button
                type="button"
                className="hub-btn"
                onClick={() => {
                  openTab('discover');
                  document.getElementById('skills-tab-discover')?.focus();
                }}
              >
                <Compass size={16} aria-hidden="true" />
                {t('skills.discover')}
              </button>
            )}
          </div>
        )}
        <ul className="skill-grid">
          {visibleSkills.map((skill) => (
            <li key={skill.id}>
              <Link
                className="hub-card skill-tile skill-installed"
                to={`/skills?skill=${skill.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="skill-emblem size-9">
                    <FileText size={17} aria-hidden="true" />
                  </span>
                  <span className={`hub-status ${skill.enabled ? 'ok' : 'muted'}`}>
                    <span className="hub-dot" aria-hidden="true" />
                    {t(skill.enabled ? 'skills.enabled' : 'skills.disabled')}
                  </span>
                </div>
                <div>
                  <h2 className="text-base font-semibold [overflow-wrap:anywhere]">{skill.name}</h2>
                  <p className="skill-description line-clamp-3">{skill.description}</p>
                </div>
                <div className="hub-border-t mt-auto flex items-center justify-between gap-2 pt-3 text-xs text-[var(--hub-ink-2)]">
                  {t('skills.files', { count: skill.files.length })}
                  <ArrowRight size={16} aria-hidden="true" />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </>
  );

  const detail = (
    <>
      <Link
        to="/skills"
        className="mb-3 inline-flex items-center gap-2 text-sm text-[var(--hub-ink-3)] hover:text-[var(--hub-ink)]"
      >
        <ArrowLeft size={15} aria-hidden="true" />
        {t('skills.title')}
      </Link>
      {error && (
        <p className="mb-3 text-sm text-[var(--hub-err)]" role="alert">
          {error}
        </p>
      )}
      {!selected && (
        <p className="hub-sub" role="status">
          {loading ? t('app.loading') : !error && t('skills.notFound')}
        </p>
      )}
      {selected && (
        <>
          <header className="mb-4">
            <h1 className="hub-h1 [overflow-wrap:anywhere]">{selected.name}</h1>
          </header>
          <div className="skill-overview mb-4">
            <div className="hub-card flex min-w-0 items-start p-5">
              <p className="m-0 max-w-[74ch] text-[15px] leading-[1.65] text-[var(--hub-ink-2)] [overflow-wrap:anywhere]">
                {selected.description}
              </p>
            </div>
            <form
              className="hub-card min-w-0 overflow-hidden text-[13px] text-[var(--hub-ink-2)] [&_input]:accent-[var(--hub-ink-2)]"
              key={JSON.stringify([
                selected.id,
                selected.enabled,
                selected.global,
                selected.groupIds,
              ])}
              onChange={(event) => void publish(event.currentTarget, selected.id)}
              onSubmit={(event) => event.preventDefault()}
            >
              <div className="hub-bg-2 hub-border-b px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="hub-sect">{t('skills.source')}</span>
                  {selected.source.type !== 'directory' && (
                    <code className="hub-tag">{selected.source.commit.slice(0, 12)}</code>
                  )}
                </div>
                <p className="mt-1 text-xs [overflow-wrap:anywhere]">
                  {selected.source.type === 'directory'
                    ? t('skills.directory')
                    : selected.source.url.replace(/^https:\/\//, '')}
                </p>
              </div>
              <div className="space-y-3 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <fieldset
                    aria-label={t('skills.publication')}
                    disabled={busy || loading || groupsLoading || !!groupsError}
                    className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2"
                  >
                    {(['enabled', 'global'] as const).map((name) => (
                      <label key={name} className="flex cursor-pointer items-center gap-2">
                        <input
                          className="sr-only"
                          name={name}
                          type="checkbox"
                          role="switch"
                          defaultChecked={selected[name]}
                        />
                        <span className="hub-switch compact" aria-hidden="true" />
                        {t(`skills.${name}`)}
                      </label>
                    ))}
                  </fieldset>
                  <div className="ms-auto flex items-center gap-2">
                    <button
                      type="button"
                      className="hub-btn danger"
                      disabled={busy}
                      onClick={() => setRemoval(selected)}
                    >
                      {t('common.delete')}
                    </button>
                    <button
                      type="button"
                      className="hub-btn"
                      disabled={busy || loading}
                      onClick={refresh}
                      aria-label={t('common.refresh')}
                      title={t('common.refresh')}
                    >
                      <RefreshCw size={14} aria-hidden="true" />
                    </button>
                  </div>
                </div>
                {groups.length > 0 && (
                  <fieldset
                    disabled={busy || loading || groupsLoading || !!groupsError}
                    className="flex flex-wrap gap-x-4 gap-y-2"
                    aria-label={t('nav.groups')}
                  >
                    {groups.map((group) => (
                      <label key={group.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          name="group"
                          value={group.id}
                          defaultChecked={selected.groupIds.includes(group.id)}
                        />
                        {group.name}
                      </label>
                    ))}
                  </fieldset>
                )}
                {groupsError && <p role="alert">{groupsError}</p>}
              </div>
            </form>
          </div>
          <SkillFileBrowser key={selected.id} skill={selected} revision={revision} />
        </>
      )}
    </>
  );

  return (
    <div className="skills-workspace">
      {id ? detail : catalog}
      {importTarget && (
        <SkillImportDialog
          target={importTarget}
          onClose={() => setImportTarget(undefined)}
          onImported={(skill) => {
            setSkills((current) => [...current, skill]);
            setInstalledQuery('');
            navigate(`/skills?skill=${skill.id}`);
            setImportTarget(undefined);
          }}
        />
      )}
      <ConfirmDialog
        isOpen={!!removal}
        variant="danger"
        title={t('common.delete')}
        message={t('skills.removeConfirm', { name: removal?.name })}
        onClose={() => setRemoval(undefined)}
        confirmDisabled={busy}
        onConfirm={() => {
          if (!removal) return;
          void run(
            () => apiDelete(`/skills/${removal.id}`),
            () => {
              setSkills((current) => current.filter(({ id }) => id !== removal.id));
              setRemoval(undefined);
              navigate('/skills', { replace: true });
            },
          );
        }}
      />
    </div>
  );
}

export default function SkillsPage() {
  const { auth } = useAuth();
  return auth.user?.isAdmin ? <SkillManager /> : <Navigate to="/" replace />;
}
