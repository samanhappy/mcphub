import { useEffect, useMemo, useState } from 'react';
import { FileText } from 'lucide-react';
import { micromark } from 'micromark';
import { useTranslation } from 'react-i18next';
import type { HostedSkill, SkillFile, SkillPreview } from '../../../src/types/hostedSkill';
import type { ApiResponse } from '@/types';
import { formatBytes } from '@/utils/contextCost';
import { apiGet } from '@/utils/fetchInterceptor';

export default function SkillFileBrowser({
  skill,
  revision,
}: {
  skill: HostedSkill;
  revision: number;
}) {
  const { t } = useTranslation();
  const [selectedPath, setSelectedPath] = useState('SKILL.md');
  const file =
    skill.files.find(({ path }) => path === selectedPath) ??
    skill.files.find(({ path }) => path === 'SKILL.md')!;
  const endpoint = `/skills/${skill.id}/file?${new URLSearchParams({ path: file.path })}`;
  const requestKey = JSON.stringify([endpoint, skill.version, revision]);
  const [result, setResult] = useState<{ key: string; response: ApiResponse<SkillPreview> }>();
  const response = result?.key === requestKey ? result.response : undefined;
  const preview = response?.success ? response.data : undefined;

  useEffect(() => {
    let active = true;
    void apiGet<ApiResponse<SkillPreview>>(endpoint).then((response) => {
      if (active) setResult({ key: requestKey, response });
    });
    return () => {
      active = false;
    };
  }, [endpoint, requestKey]);

  const html = useMemo(() => {
    if (preview?.kind !== 'text' || !/\.md$/i.test(file.path)) return;
    const markdown = /(^|\/)SKILL\.md$/.test(file.path)
      ? preview.text.replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '')
      : preview.text;
    // Keep micromark's HTML and protocol escaping and block inline image requests.
    return micromark(markdown, { extensions: [{ disable: { null: ['labelStartImage'] } }] });
  }, [file.path, preview]);

  const folders = new Map<string, SkillFile[]>([['', []]]);
  for (const entry of skill.files) {
    const folder = entry.path.slice(0, entry.path.lastIndexOf('/') + 1);
    const entries = folders.get(folder) ?? [];
    entries.push(entry);
    folders.set(folder, entries);
  }

  return (
    <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
      <nav
        className="hub-card min-w-0 overflow-hidden"
        aria-label={t('skills.files', { count: skill.files.length })}
      >
        <h2 className="hub-border-b hub-sect px-4 py-3">
          {t('skills.files', { count: skill.files.length })}
        </h2>
        <div className="max-h-56 overflow-auto p-2 lg:max-h-[65vh]">
          {[...folders]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([folder, entries]) => (
              <div key={folder}>
                {folder && (
                  <p className="hub-mono break-all px-2 pb-1 pt-3 text-xs text-[var(--hub-ink-3)]">
                    {folder}
                  </p>
                )}
                {entries.map((entry) => (
                  <button
                    type="button"
                    key={entry.path}
                    title={entry.path}
                    aria-current={entry.path === file.path ? 'true' : undefined}
                    onClick={() => setSelectedPath(entry.path)}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--hub-surface-hover)] aria-[current=true]:bg-[var(--hub-surface-hover)] aria-[current=true]:font-semibold"
                  >
                    <FileText
                      size={14}
                      className="shrink-0 text-[var(--hub-ink-3)]"
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      {entry.path.slice(folder.length)}
                    </span>
                    <span className="shrink-0 text-xs font-normal text-[var(--hub-ink-3)]">
                      {formatBytes(entry.size)}
                    </span>
                  </button>
                ))}
              </div>
            ))}
        </div>
      </nav>
      <section
        className="hub-card min-w-0 overflow-hidden"
        aria-labelledby="skill-file-heading"
        aria-busy={!response}
      >
        <div className="hub-border-b flex flex-wrap items-baseline gap-2 px-4 py-3">
          <h2 id="skill-file-heading" className="hub-mono min-w-0 break-all text-sm font-semibold">
            {file.path}
          </h2>
          <span className="text-xs text-[var(--hub-ink-3)]">{formatBytes(file.size)}</span>
        </div>
        <div className="min-h-44 overflow-auto p-4 sm:p-6 lg:max-h-[65vh]">
          {!response && (
            <p className="hub-sub" role="status">
              {t('common.loading')}
            </p>
          )}
          {response && !preview && (
            <p role="alert" className="text-[var(--hub-err)]">
              {response.message || t('skills.requestFailed')}
            </p>
          )}
          {preview?.kind === 'image' && (
            <img
              className="mx-auto max-h-[55vh] max-w-full object-contain"
              src={`data:${preview.mimeType};base64,${preview.base64}`}
              alt={file.path}
            />
          )}
          {preview?.kind === 'binary' && <p className="hub-sub">{t('skills.binaryPreview')}</p>}
          {preview?.kind === 'too-large' && <p className="hub-sub">{t('skills.largePreview')}</p>}
          {preview?.kind === 'text' &&
            (html === undefined ? (
              <pre className="hub-mono w-full whitespace-pre-wrap break-all text-sm leading-relaxed">
                {preview.text}
              </pre>
            ) : (
              <div
                className="skill-markdown"
                dangerouslySetInnerHTML={{ __html: html }}
                onClick={(event) => {
                  const href = (event.target as Element).closest('a')?.getAttribute('href');
                  if (href == null || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return;
                  event.preventDefault();
                  try {
                    const base = file.path.split('/').map(encodeURIComponent).join('/');
                    const target = new URL(href, `https://skill.invalid/${base}`);
                    const path = decodeURIComponent(target.pathname.slice(1));
                    if (
                      target.origin === 'https://skill.invalid' &&
                      skill.files.some((entry) => entry.path === path)
                    ) {
                      setSelectedPath(path);
                    }
                  } catch {
                    // A malformed link cannot identify an imported file.
                  }
                }}
              />
            ))}
        </div>
      </section>
    </div>
  );
}
