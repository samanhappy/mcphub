import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate } from 'react-router-dom';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import { useAuth } from '@/contexts/AuthContext';
import { useGroupData } from '@/hooks/useGroupData';
import type { ApiResponse } from '@/types';
import { apiDelete, apiGet, apiPut, apiRequest } from '@/utils/fetchInterceptor';
import type { HostedSkill, SkillPublication } from '../../../src/types/hostedSkill';

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

function SkillManager() {
  const { t } = useTranslation();
  const { groups, loading: groupsLoading, error: groupsError } = useGroupData();
  const [skills, setSkills] = useState<HostedSkill[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [source, setSource] = useState<'directory' | 'github'>('directory');
  const [url, setUrl] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [replacement, setReplacement] = useState<HostedSkill>();
  const [removal, setRemoval] = useState<HostedSkill>();
  const importForm = useRef<HTMLFormElement>(null);

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
  }, [t]);

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

  const selectSource = (type: 'directory' | 'github') => {
    setSource(type);
    setFiles([]);
    setUrl('');
  };

  const reset = () => {
    setReplacement(undefined);
    selectSource('directory');
    importForm.current?.reset();
  };

  const submitImport = (event: FormEvent) => {
    event.preventDefault();
    void run(
      async () => {
        const endpoint = replacement ? `/skills/${replacement.id}/content` : '/skills';
        const method = replacement ? 'PUT' : 'POST';
        if (source === 'github') {
          return apiRequest(endpoint, {
            method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: url.trim() }),
          });
        }
        const body = await prepareUpload(files);
        return body
          ? apiRequest(endpoint, { method, body })
          : {
              success: false,
              message: t('skills.invalidDirectory'),
            };
      },
      (skill) => {
        if (replacement) replaceSkill(skill);
        else setSkills((current) => [...current, skill]);
        reset();
      },
    );
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

  return (
    <div className="space-y-4">
      <h1 className="hub-h1">{t('skills.title')}</h1>
      <form ref={importForm} onSubmit={submitImport} className="hub-card space-y-3 p-4">
        <h2 className="font-semibold">
          {replacement ? t('skills.replaceTitle', { name: replacement.name }) : t('skills.import')}
        </h2>
        <fieldset disabled={busy || loading} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            {t('skills.source')}
            <select
              className="hub-input"
              value={source}
              onChange={(event) =>
                selectSource(event.target.value === 'github' ? 'github' : 'directory')
              }
            >
              <option value="directory">{t('skills.directory')}</option>
              <option value="github">GitHub</option>
            </select>
          </label>
          {source === 'directory' ? (
            <label className="flex min-w-0 flex-col gap-1">
              {t('skills.directory')}
              <input
                className="hub-input max-w-full"
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
            <label className="flex min-w-0 flex-1 flex-col gap-1">
              {t('skills.githubUrl')}
              <input
                className="hub-input w-full"
                type="url"
                required
                value={url}
                placeholder="https://github.com/owner/repo/tree/main/skill-name"
                onChange={(event) => setUrl(event.target.value)}
              />
            </label>
          )}
          <button className="hub-btn primary" type="submit">
            {replacement ? t('common.save') : t('skills.import')}
          </button>
          {replacement && (
            <button className="hub-btn" type="button" onClick={reset}>
              {t('common.cancel')}
            </button>
          )}
        </fieldset>
      </form>
      {error && (
        <p className="text-red-600" role="alert">
          {error}
        </p>
      )}
      {loading && <p role="status">{t('common.loading')}</p>}
      {!loading && !skills.length && !error && <p>{t('skills.empty')}</p>}
      {skills.map((skill) => (
        <section key={skill.id} className="hub-card space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="break-words font-semibold">{skill.name}</h2>
              <p className="break-words text-sm">{skill.description}</p>
              <p className="break-all text-sm">
                {skill.source.type === 'github'
                  ? `${skill.source.url} · ${skill.source.commit.slice(0, 12)}`
                  : t('skills.directory')}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="hub-btn"
                disabled={busy}
                onClick={() => {
                  setReplacement(skill);
                  selectSource(skill.source.type);
                  if (skill.source.type === 'github') setUrl(skill.source.url);
                  importForm.current?.reset();
                  importForm.current?.scrollIntoView({ block: 'start' });
                }}
              >
                {t('skills.replace')}
              </button>
              <button
                type="button"
                className="hub-btn danger"
                disabled={busy}
                onClick={() => setRemoval(skill)}
              >
                {t('common.delete')}
              </button>
            </div>
          </div>
          <details>
            <summary className="cursor-pointer">
              {t('skills.files', { count: skill.files.length })}
            </summary>
            <ul className="mt-2 space-y-1 text-sm">
              {skill.files.map((file) => (
                <li key={file.uri} className="break-all font-mono">
                  {file.path}
                </li>
              ))}
            </ul>
          </details>
          <form
            key={JSON.stringify([skill.enabled, skill.global, skill.groupIds])}
            onSubmit={(event) => publish(event, skill.id)}
          >
            <fieldset disabled={busy || groupsLoading || !!groupsError} className="space-y-2">
              <legend className="font-medium">{t('skills.publication')}</legend>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <label className="flex items-center gap-2">
                  <input name="enabled" type="checkbox" defaultChecked={skill.enabled} />
                  {t('skills.enabled')}
                </label>
                <label className="flex items-center gap-2">
                  <input name="global" type="checkbox" defaultChecked={skill.global} />
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
                        defaultChecked={skill.groupIds.includes(group.id)}
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
        </section>
      ))}
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
              if (replacement?.id === removal.id) reset();
              setRemoval(undefined);
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
