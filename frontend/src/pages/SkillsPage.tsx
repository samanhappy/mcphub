import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, ChevronRight, Plus, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import SkillFileBrowser from '@/components/SkillFileBrowser';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useGroupData } from '@/hooks/useGroupData';
import { useSettingsData } from '@/hooks/useSettingsData';
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

type SkillImport = { replacement?: HostedSkill; catalogUrl?: string };

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
  const { replacement, catalogUrl } = target;
  const previous = replacement?.source;
  const [source, setSource] = useState<HostedSkill['source']['type']>(
    catalogUrl ? 'skills-sh' : (previous?.type ?? 'directory'),
  );
  const [url, setUrl] = useState(
    catalogUrl ?? (previous?.type !== 'directory' ? previous?.url : '') ?? '',
  );
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
      const endpoint = replacement ? `/skills/${replacement.id}/content` : '/skills';
      const method = replacement ? 'PUT' : 'POST';
      let response: ApiResponse<HostedSkill>;
      if (source === 'directory') {
        const body = await prepareUpload(files);
        if (!body) {
          setError(t('skills.invalidDirectory'));
          return;
        }
        response = await apiRequest(endpoint, { method, body });
      } else {
        response = await apiRequest(endpoint, {
          method,
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
          {replacement ? t('skills.replaceTitle', { name: replacement.name }) : t('skills.import')}
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
            {busy ? t('common.loading') : replacement ? t('common.save') : t('skills.import')}
          </button>
        </div>
      </form>
    </dialog>
  );
}

function SkillProxySettings({ hidden }: { hidden: boolean }) {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { skillImportProxy, loading, fetchSettings } = useSettingsData();
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
      className="hub-card hub-card-pad max-w-2xl"
    >
      <h2 className="mb-1 font-medium text-[var(--hub-ink)]">{t('skills.proxySettings')}</h2>
      <form onSubmit={saveSkillProxy} className="space-y-4">
        <p className="hub-sub">{t('skills.proxyHelp')}</p>
        <label className="block text-sm">
          {t('skills.proxyMode')}
          <select
            className="hub-input mt-1 block w-full sm:w-auto"
            value={proxyMode}
            onChange={(event) => setProxyMode(event.target.value)}
            disabled={loading || savingSkillProxy}
          >
            <option value="server">{t('skills.proxyServer')}</option>
            <option value="direct">{t('skills.proxyDirect')}</option>
            <option value="custom">{t('skills.proxyCustom')}</option>
          </select>
        </label>
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

function SkillManager() {
  const [searchParams] = useSearchParams();
  const id = searchParams.get('skill');
  const navigate = useNavigate();
  const [revision, setRevision] = useState(0);
  const { t, i18n } = useTranslation();
  const { groups, loading: groupsLoading, error: groupsError } = useGroupData();
  const [skills, setSkills] = useState<HostedSkill[]>([]);
  const selected = skills.find((skill) => skill.id === id);
  const importedUrls = new Set(
    skills.flatMap(({ source }) => (source.type === 'skills-sh' ? [source.url] : [])),
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<(typeof tabs)[number]>('installed');
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
      if (result.success) onSuccess(result.data);
      else setError(result.message || t('skills.requestFailed'));
    } catch {
      setError(t('skills.requestFailed'));
    } finally {
      setBusy(false);
    }
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

  const publish = (event: FormEvent<HTMLFormElement>, skillId: string) => {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const publication: SkillPublication = {
      enabled: fields.has('enabled'),
      global: fields.has('global'),
      groupIds: fields.getAll('group').map(String),
    };
    void run(() => apiPut(`/skills/${skillId}`, publication), replaceSkill);
  };

  const refresh = () => {
    setLoading(true);
    setError('');
    setRevision((current) => current + 1);
  };

  const catalog = (
    <>
      <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
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
        className="hub-border-b mb-4 flex gap-1"
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
          document.getElementById(`skills-tab-${next}`)?.click();
        }}
      >
        {tabs.map((item) => (
          <button
            key={item}
            id={`skills-tab-${item}`}
            type="button"
            role="tab"
            aria-controls={`skills-panel-${item}`}
            aria-selected={tab === item}
            tabIndex={tab === item ? 0 : -1}
            className="cursor-pointer border-b-2 border-transparent px-3 py-2 text-sm text-[var(--hub-ink-3)] hover:text-[var(--hub-ink)] aria-selected:border-[var(--hub-ink)] aria-selected:font-medium aria-selected:text-[var(--hub-ink)]"
            onClick={() => {
              setTab(item);
              if (item === 'discover' && !results && !searchError) void search('');
            }}
          >
            {t(`skills.${item}`)}
          </button>
        ))}
      </div>
      <SkillProxySettings hidden={tab !== 'configuration'} />
      <section
        id="skills-panel-discover"
        role="tabpanel"
        aria-labelledby="skills-tab-discover"
        hidden={tab !== 'discover'}
        className="hub-card hub-card-pad space-y-3"
      >
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void search(query.trim());
          }}
        >
          <label className="flex min-w-0 grow basis-56 flex-col gap-1">
            <span className="hub-sect">{t('skills.searchCatalog')}</span>
            <input
              className="hub-input w-full"
              type="search"
              value={query}
              maxLength={100}
              onChange={(event) => setQuery(event.target.value)}
            />
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
            {t('common.loading')}
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
          <ul>
            {results.map((result) => (
              <li
                key={result.url}
                className="hub-border-t flex flex-wrap items-center justify-between gap-2 py-3"
              >
                <div className="min-w-0">
                  <a
                    className="break-words text-sm font-medium hover:underline"
                    href={result.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {result.name}
                  </a>
                  <p className="hub-sub break-all">
                    {result.source}
                    {result.installs !== null &&
                      ` · ${t('skills.installCount', { count: result.installs, formatted: result.installs.toLocaleString(i18n.language) })}`}
                  </p>
                </div>
                <button
                  type="button"
                  className="hub-btn"
                  disabled={busy || loading || importedUrls.has(result.url)}
                  aria-label={`${t(importedUrls.has(result.url) ? 'skills.imported' : 'skills.import')} ${result.name} (${result.source})`}
                  onClick={() => setImportTarget({ catalogUrl: result.url })}
                >
                  {t(importedUrls.has(result.url) ? 'skills.imported' : 'skills.import')}
                </button>
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
            {t('common.loading')}
          </p>
        )}
        {!loading && !skills.length && !error && (
          <p className="hub-card p-10 text-center text-[13px] text-[var(--hub-ink-3)]">
            {t('skills.empty')}
          </p>
        )}
        {skills.map((skill) => (
          <section key={skill.id} className="hub-card hub-card-pad mb-3">
            <h2 className="hub-card-title break-words">
              <Link className="hover:underline" to={`/skills?skill=${skill.id}`}>
                {skill.name}
              </Link>
            </h2>
            <p className="hub-sub break-words">{skill.description}</p>
            <p className="mt-2 text-xs text-[var(--hub-ink-3)]">
              {t('skills.files', { count: skill.files.length })}
            </p>
          </section>
        ))}
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
          {loading ? t('common.loading') : !error && t('skills.notFound')}
        </p>
      )}
      {selected && (
        <>
          <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="hub-h1 break-words">{selected.name}</h1>
              <p className="hub-sub mt-1 max-w-4xl break-words">{selected.description}</p>
              <p className="mt-1 break-all text-xs text-[var(--hub-ink-3)]">
                {selected.source.type === 'directory'
                  ? t('skills.directory')
                  : `${selected.source.url} · ${selected.source.commit.slice(0, 12)}`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="hub-btn"
                disabled={busy}
                onClick={() => setImportTarget({ replacement: selected })}
              >
                {t('skills.replace')}
              </button>
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
          </header>
          <details className="hub-card hub-card-pad group mb-4">
            <summary className="flex w-fit cursor-pointer items-center gap-2 text-sm font-medium [&::-webkit-details-marker]:hidden">
              <ChevronRight size={14} aria-hidden="true" className="group-open:rotate-90" />
              {t('skills.publication')}
              <span className="text-xs font-normal text-[var(--hub-ink-3)]">
                {t(selected.enabled ? 'skills.enabled' : 'skills.disabled')}
              </span>
            </summary>
            <form
              className="pt-3 text-[13px] text-[var(--hub-ink-2)] [&_input]:accent-[var(--hub-ink-2)]"
              key={JSON.stringify([selected.enabled, selected.global, selected.groupIds])}
              onSubmit={(event) => publish(event, selected.id)}
            >
              <fieldset
                aria-label={t('skills.publication')}
                disabled={busy || groupsLoading || !!groupsError}
                className="space-y-2"
              >
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                  <label className="flex items-center gap-2">
                    <input name="enabled" type="checkbox" defaultChecked={selected.enabled} />
                    {t('skills.enabled')}
                  </label>
                  <label className="flex items-center gap-2">
                    <input name="global" type="checkbox" defaultChecked={selected.global} />
                    {t('skills.global')}
                  </label>
                </div>
                {groups.length > 0 && (
                  <div
                    className="flex flex-wrap gap-x-4 gap-y-2"
                    role="group"
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
                  </div>
                )}
                {groupsError && <p role="alert">{groupsError}</p>}
                <button className="hub-btn primary" type="submit">
                  {t('common.save')}
                </button>
              </fieldset>
            </form>
          </details>
          <SkillFileBrowser key={selected.id} skill={selected} revision={revision} />
        </>
      )}
    </>
  );

  return (
    <div>
      {id ? detail : catalog}
      {importTarget && (
        <SkillImportDialog
          target={importTarget}
          onClose={() => setImportTarget(undefined)}
          onImported={(skill) => {
            if (importTarget.replacement) replaceSkill(skill);
            else setSkills((current) => [...current, skill]);
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
