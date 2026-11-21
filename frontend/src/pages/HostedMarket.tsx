import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Search } from 'lucide-react';
import MarketCategories from '@/components/MarketCategories';
import MarketServerCard from '@/components/MarketServerCard';
import ServerForm from '@/components/ServerForm';
import Pagination from '@/components/ui/Pagination';
import { useAuth } from '@/contexts/AuthContext';
import { useServerContext } from '@/contexts/ServerContext';
import { useToast } from '@/contexts/ToastContext';
import type { ServerConfig } from '@/types';
import { apiGet, apiPost, type ApiResponse } from '@/utils/fetchInterceptor';
import { slugifyServerName } from '@/utils/serverName';
import { getServerConfigPermissionError } from '@/utils/serverPermissions';

const CATALOG = '/market/catalog';
const WEBSITE = 'https://www.mcphub.app/registry';
const PAGE_SIZE = 12;
const CARD_GRID = 'grid gap-3 md:grid-cols-2 xl:grid-cols-3';

interface CatalogServer {
  author: string;
  name: string;
  displayName: string;
  description: string;
  transports: string[];
  categories: string[];
  tags: string[];
  github: { stars: number };
}

interface CatalogDetail extends CatalogServer {
  installations: Record<string, unknown>;
  arguments: Record<string, { description: string; required?: boolean }>;
}

interface CatalogPage {
  items: CatalogServer[];
  total: number;
  page: number;
  pageSize: number;
}

interface CatalogCategory {
  slug: string;
  name: string;
  count: number;
}

function useCatalog<T>(path: string) {
  const [result, setResult] = useState<{ path: string; data?: T }>();

  useEffect(() => {
    let active = true;
    void apiGet<ApiResponse<T>>(path).then((response) => {
      if (active) setResult({ path, data: response.success ? response.data : undefined });
    });
    return () => {
      active = false;
    };
  }, [path]);

  return { loading: result?.path !== path, data: result?.path === path ? result.data : undefined };
}

function installationConfig(value: unknown): ServerConfig | undefined {
  if (!value || typeof value !== 'object') return;
  if ('type' in value && value.type === 'http' && 'url' in value && typeof value.url === 'string') {
    try {
      const url = new URL(value.url);
      if (
        ['http:', 'https:'].includes(url.protocol) &&
        !url.username &&
        !url.password &&
        !url.hash
      ) {
        return { type: 'streamable-http', url: url.href };
      }
    } catch {
      return;
    }
  }
  if (
    !('type' in value) ||
    typeof value.type !== 'string' ||
    !['npm', 'uvx', 'pip', 'docker', 'binary'].includes(value.type)
  )
    return;
  if (
    !('command' in value) ||
    typeof value.command !== 'string' ||
    !value.command.trim() ||
    !('args' in value) ||
    !Array.isArray(value.args) ||
    !value.args.every((arg) => typeof arg === 'string')
  )
    return;
  const env =
    'env' in value && value.env && typeof value.env === 'object' && !Array.isArray(value.env)
      ? Object.fromEntries(
          Object.entries(value.env).filter(([, value]) => typeof value === 'string'),
        )
      : undefined;
  return { type: 'stdio', command: value.command, args: value.args, env };
}

function registryPath({ author, name }: Pick<CatalogServer, 'author' | 'name'>) {
  return `${encodeURIComponent(author)}/${encodeURIComponent(name)}`;
}

function HostedMarketDetail({ entry }: { entry: string }) {
  const { t } = useTranslation();
  const { auth } = useAuth();
  const { showToast } = useToast();
  const { triggerRefresh } = useServerContext();
  const { data, loading } = useCatalog<CatalogDetail>(`${CATALOG}/${entry}`);
  const [config, setConfig] = useState<ServerConfig>();
  const [error, setError] = useState<string>();
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);

  if (loading) return <p role="status">{t('app.loading')}</p>;
  if (!data) return <p role="alert">{t('registry.fetchError')}</p>;

  const { author, name, displayName, description, transports, installations } = data;
  const methods = Object.entries(installations ?? {}).flatMap(([method, value]) => {
    const config = installationConfig(value);
    return config ? [{ method, config }] : [];
  });

  const install = async (payload: { name: string; config: ServerConfig }) => {
    if (installing) return;
    setInstalling(true);
    setError(undefined);
    try {
      const response = await apiPost<ApiResponse<unknown>>('/servers', payload);
      if (!response.success) {
        setError(t('registry.installError', { error: response.message ?? '' }));
        return;
      }
      setConfig(undefined);
      setInstalled(true);
      showToast(t('registry.installSuccess', { name: displayName }), 'success');
      triggerRefresh();
    } finally {
      setInstalling(false);
    }
  };

  return (
    <section className="hub-card p-5 sm:p-7">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h1 className="hub-h1 break-words">{displayName}</h1>
          <p className="hub-mono text-[13px] break-all text-[var(--hub-ink-3)]">
            @{author}/{name}
          </p>
        </div>
        <a
          className="hub-btn"
          href={`${WEBSITE}/${registryPath(data)}`}
          target="_blank"
          rel="noreferrer"
        >
          MCPHub Registry <ExternalLink size={14} />
        </a>
      </div>
      <p className="my-5 max-w-3xl whitespace-pre-wrap break-words text-[var(--hub-ink-2)]">
        {description}
      </p>
      <div className="flex flex-wrap gap-2">
        {transports.map((type) => (
          <span key={type} className="hub-tag">
            {type}
          </span>
        ))}
      </div>
      {!!Object.keys(data.arguments ?? {}).length && (
        <dl className="mt-5 space-y-2 text-sm">
          {Object.entries(data.arguments).map(([key, argument]) => (
            <div key={key}>
              <dt className="hub-mono break-all">
                {key}
                {argument.required && ` · ${t('market.required')}`}
              </dt>
              <dd className="break-words text-[var(--hub-ink-2)]">{argument.description}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-6 flex flex-wrap gap-2">
        {installed ? (
          <p role="status">{t('registry.installed')}</p>
        ) : (
          methods.map(({ method, config }) => {
            const permission = getServerConfigPermissionError(config, auth.user?.isAdmin);
            return (
              <button
                key={method}
                className="hub-btn primary"
                disabled={Boolean(permission)}
                title={permission ? t(permission) : undefined}
                onClick={() => {
                  setError(undefined);
                  setConfig(config);
                }}
              >
                {t('registry.install')} · {method === 'http' ? 'Streamable HTTP' : method}
              </button>
            );
          })
        )}
        {!methods.length && <p>{t('market.noInstallationMethod')}</p>}
      </div>
      {config && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('registry.installServer', { name: displayName })}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <ServerForm
            mode="create"
            initialData={{
              name: slugifyServerName(`${author}/${name}`),
              status: 'disconnected',
              config,
            }}
            onSubmit={install}
            onCancel={() => {
              if (!installing) setConfig(undefined);
            }}
            formError={error}
            modalTitle={t('registry.installServer', { name: displayName })}
          />
        </div>
      )}
    </section>
  );
}

function MarketGridSkeleton() {
  const { t } = useTranslation();

  return (
    <>
      <p role="status" className="sr-only">
        {t('app.loading')}
      </p>
      <div aria-hidden="true" className="motion-safe:animate-pulse">
        <div className="mb-3 flex h-5 items-center">
          <div className="h-2.5 w-40 rounded bg-[var(--hub-line)]" />
        </div>
        <div className={CARD_GRID}>
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="hub-card overflow-hidden">
              <div className="flex flex-col gap-2.5 p-3.5">
                <div className="flex h-9 items-center gap-2">
                  <div className="size-7 shrink-0 rounded-[7px] bg-[var(--hub-line)]" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="h-3 w-2/5 rounded bg-[var(--hub-line)]" />
                    <div className="h-2 w-1/4 rounded bg-[var(--hub-line)]" />
                  </div>
                </div>
                <div className="flex h-[38px] flex-col justify-center gap-2">
                  <div className="h-2.5 w-full rounded bg-[var(--hub-line)]" />
                  <div className="h-2.5 w-3/4 rounded bg-[var(--hub-line)]" />
                </div>
                <div className="flex gap-1">
                  <div className="h-[18px] w-14 rounded bg-[var(--hub-line)]" />
                  <div className="h-[18px] w-10 rounded bg-[var(--hub-line)]" />
                </div>
              </div>
              <div className="flex h-[34px] items-center gap-3 border-t border-[var(--hub-line-2)] bg-[var(--hub-bg-2)] px-3.5">
                <div className="h-2 w-12 rounded bg-[var(--hub-line)]" />
                <div className="h-2 w-16 rounded bg-[var(--hub-line)]" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function HostedMarketList({ filters }: { filters: URLSearchParams }) {
  const { t } = useTranslation();
  const [, setFilters] = useSearchParams();
  const q = filters.get('q') ?? '';
  const category = filters.get('category') ?? '';
  const transport = filters.get('transport') ?? '';
  const page = Math.max(1, parseInt(filters.get('page') ?? '1', 10) || 1);
  const query = new URLSearchParams({
    q,
    category,
    transport,
    page: String(page),
    pageSize: String(PAGE_SIZE),
  });
  const { data, loading } = useCatalog<CatalogPage>(`${CATALOG}?${query}`);
  const { data: categories, loading: categoriesLoading } = useCatalog<CatalogCategory[]>(
    `${CATALOG}/categories`,
  );

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(filters);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setFilters(next);
  };

  const search = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    update('q', String(new FormData(event.currentTarget).get('q') ?? '').trim());
  };

  return (
    <>
      <form onSubmit={search} className="hub-card mb-5 flex items-center gap-2 p-1.5">
        <Search size={16} className="mx-1.5 shrink-0 text-[var(--hub-ink-3)]" />
        <input
          key={q}
          name="q"
          defaultValue={q}
          maxLength={128}
          aria-label={t('common.search')}
          className="h-8 min-w-0 flex-1 bg-transparent text-sm"
          placeholder={t('registry.searchPlaceholder')}
        />
        <button className="hub-btn" type="submit">
          {t('common.search')}
        </button>
        {(q || category || transport) && (
          <Link className="hub-btn ghost" to="/market">
            {t('common.clear')}
          </Link>
        )}
      </form>
      <div className="grid gap-5 lg:grid-cols-[180px_minmax(0,1fr)]">
        <div className="min-w-0 space-y-4">
          <MarketCategories
            categories={categories ?? []}
            total={q || category || transport ? undefined : data?.total}
            selected={category}
            onSelect={(slug) => update('category', slug)}
            loading={categoriesLoading}
          />
          <label className="flex items-center gap-2 whitespace-nowrap">
            {t('server.type')}
            <select
              className="hub-input"
              value={transport}
              onChange={(event) => update('transport', event.target.value)}
            >
              <option value="">{t('common.all')}</option>
              <option value="stdio">STDIO</option>
              <option value="http">HTTP</option>
              <option value="sse">SSE</option>
            </select>
          </label>
        </div>
        <div className="min-w-0">
          {loading ? (
            <MarketGridSkeleton />
          ) : !data ? (
            <p role="alert">{t('registry.fetchError')}</p>
          ) : (
            <>
              {data.items.length > 0 ? (
                <p className="mb-3 text-sm text-[var(--hub-ink-3)]" role="status">
                  {t('registry.showing', {
                    from: (data.page - 1) * data.pageSize + 1,
                    to: (data.page - 1) * data.pageSize + data.items.length,
                    total: data.total.toLocaleString(),
                  })}
                </p>
              ) : (
                <p role="status">{t('registry.noServers')}</p>
              )}
              <div className={CARD_GRID}>
                {data.items.map((server) => {
                  const next = new URLSearchParams(filters);
                  next.set('entry', `${server.author}/${server.name}`);
                  return (
                    <MarketServerCard
                      key={registryPath(server)}
                      to={`/market?${next}`}
                      server={{
                        name: server.name,
                        display_name: server.displayName,
                        author: { name: server.author },
                        description: server.description,
                        categories: server.categories.map(
                          (slug) =>
                            categories?.find((category) => category.slug === slug)?.name ?? slug,
                        ),
                        tags: server.tags,
                      }}
                      stars={server.github.stars}
                      transports={server.transports}
                    />
                  );
                })}
              </div>
              <Pagination
                currentPage={data.page}
                totalPages={Math.ceil(data.total / data.pageSize)}
                onPageChange={(nextPage) => {
                  update('page', String(nextPage));
                  window.scrollTo({ top: 0 });
                }}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default function HostedMarket() {
  const { t } = useTranslation();
  const [filters] = useSearchParams();
  const identity = filters.get('entry')?.split('/');
  if (identity) {
    const back = new URLSearchParams(filters);
    back.delete('entry');
    const entry =
      identity.length === 2 && identity.every((slug) => /^[a-z\d][a-z\d._-]{0,127}$/i.test(slug))
        ? identity.map(encodeURIComponent).join('/')
        : undefined;
    return (
      <>
        <Link className="hub-btn ghost mb-4" to={`/market?${back}`}>
          <ArrowLeft size={16} /> {t('market.backToList')}
        </Link>
        {entry ? (
          <HostedMarketDetail key={entry} entry={entry} />
        ) : (
          <p role="alert">{t('registry.serverNotFound')}</p>
        )}
      </>
    );
  }

  return <HostedMarketList filters={filters} />;
}
