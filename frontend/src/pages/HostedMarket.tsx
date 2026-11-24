import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Search } from 'lucide-react';
import { micromark } from 'micromark';
import MarketCategories from '@/components/MarketCategories';
import MarketServerCard from '@/components/MarketServerCard';
import ServerForm from '@/components/ServerForm';
import Pagination from '@/components/ui/Pagination';
import { useAuth } from '@/contexts/AuthContext';
import { useServerContext } from '@/contexts/ServerContext';
import { useToast } from '@/contexts/ToastContext';
import type { ServerConfig } from '@/types';
import { apiGet, apiPost, type ApiResponse } from '@/utils/fetchInterceptor';
import { MARKET_PAGE_SIZE_OPTIONS } from '@/utils/marketPagination';
import { slugifyServerName } from '@/utils/serverName';
import { getServerConfigPermissionError } from '@/utils/serverPermissions';

const CATALOG = '/market/catalog';
const WEBSITE = 'https://www.mcphub.app/registry';
const DEFAULT_PAGE_SIZE = 12;
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
  toolCount?: number;
}

interface CatalogDetail extends CatalogServer {
  installations: Record<string, unknown>;
  arguments: Record<string, { description: string; required?: boolean }>;
  readme?: string | null;
  language?: string;
  license?: string;
  websiteUrl?: string;
  officialUrl?: string;
  officialMetadata?: { version: string; status: string; publishedAt?: string; updatedAt?: string };
  tools?: { name: string; description?: string; inputSchema?: Record<string, unknown> }[];
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

function useCatalog<T>(path: string, enabled = true) {
  const [result, setResult] = useState<{ path: string; data?: T }>();

  useEffect(() => {
    if (!enabled || result?.path === path) return;
    let active = true;
    void apiGet<ApiResponse<T>>(path).then((response) => {
      if (active) setResult({ path, data: response.success ? response.data : undefined });
    });
    return () => {
      active = false;
    };
  }, [enabled, path, result]);

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
  const { t, i18n } = useTranslation();
  const { auth } = useAuth();
  const { showToast } = useToast();
  const { triggerRefresh } = useServerContext();
  const { data, loading } = useCatalog<CatalogDetail>(`${CATALOG}/${entry}`);
  const readmeHtml = useMemo(() => {
    if (typeof data?.readme !== 'string' || !data.readme.trim()) return;
    // Keep micromark's HTML and URL escaping and omit the dashboard URL from image requests.
    return micromark(data.readme).replace(
      /<img /g,
      '<img loading="lazy" referrerpolicy="no-referrer" ',
    );
  }, [data?.readme]);
  const [config, setConfig] = useState<ServerConfig>();
  const [error, setError] = useState<string>();
  const [installing, setInstalling] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [tab, setTab] = useState<'overview' | 'tools' | 'parameters'>('overview');

  if (loading) {
    return (
      <section className="hub-card p-4 sm:p-5">
        <p role="status" className="sr-only">
          {t('app.loading')}
        </p>
        <div aria-hidden="true" className="motion-safe:animate-pulse">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="w-52 max-w-full space-y-2">
              <div className="h-6 w-4/5 rounded bg-[var(--hub-line)]" />
              <div className="h-3 w-3/5 rounded bg-[var(--hub-line)]" />
            </div>
            <div className="flex gap-2">
              <div className="h-8 w-24 rounded-lg bg-[var(--hub-line)]" />
              <div className="h-8 w-36 rounded-lg bg-[var(--hub-line)]" />
            </div>
          </div>
          <div className="my-3 max-w-3xl space-y-2">
            <div className="h-3 w-11/12 rounded bg-[var(--hub-line)]" />
            <div className="h-3 w-2/3 rounded bg-[var(--hub-line)]" />
          </div>
          <div className="flex gap-2">
            <div className="h-5 w-12 rounded bg-[var(--hub-line)]" />
            <div className="h-5 w-9 rounded bg-[var(--hub-line)]" />
          </div>
          <div className="mt-4 space-y-3 border-t border-[var(--hub-line)] pt-4">
            <div className="h-4 w-32 rounded bg-[var(--hub-line)]" />
            <div className="h-3 w-5/6 max-w-3xl rounded bg-[var(--hub-line)]" />
            <div className="h-3 w-3/5 max-w-2xl rounded bg-[var(--hub-line)]" />
          </div>
        </div>
      </section>
    );
  }
  if (!data) return <p role="alert">{t('registry.fetchError')}</p>;

  const { author, name, displayName, description, transports, installations } = data;
  const parameters = Object.entries(data.arguments ?? {});
  const tabs = [
    { id: 'overview', label: t('registry.overview'), count: 0 },
    { id: 'tools', label: t('cloud.tools'), count: data.tools?.length ?? 0 },
    ...(parameters.length
      ? [{ id: 'parameters', label: t('cloud.parameters'), count: parameters.length } as const]
      : []),
  ] as const;
  const methods = Object.entries(installations ?? {}).flatMap(([method, value]) => {
    const config = installationConfig(value);
    return config ? [{ method, config }] : [];
  });

  const metadata = data.officialMetadata;
  const formatDate = (value?: string) => {
    if (!value) return;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return new Intl.DateTimeFormat(i18n.resolvedLanguage, {
        dateStyle: 'medium',
        timeZone: 'UTC',
      }).format(date);
    }
  };
  const overview = [
    [t('mcpb.version'), metadata?.version],
    [t('registry.published'), formatDate(metadata?.publishedAt)],
    [t('registry.updated'), formatDate(metadata?.updatedAt)],
    [t('server.status'), metadata?.status],
    [t('market.categories'), data.categories?.join(', ')],
    [t('common.language'), data.language],
    [t('market.license'), data.license],
    ...methods.flatMap(({ config }) =>
      config.type === 'streamable-http' ? [['Streamable HTTP', config.url]] : [],
    ),
  ].filter(([, value]) => value);

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
    <section className="hub-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="hub-h1 break-words">{displayName}</h1>
          <p className="hub-mono text-[13px] break-all text-[var(--hub-ink-3)]">
            @{author}/{name}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          <a
            className="hub-btn"
            href={`${WEBSITE}/${registryPath(data)}`}
            target="_blank"
            rel="noreferrer"
          >
            MCPHub Registry <ExternalLink size={14} />
          </a>
          {!methods.length && (
            <p className="basis-full text-sm text-[var(--hub-ink-3)]">
              {t('market.noInstallationMethod')}
            </p>
          )}
        </div>
      </div>
      <p className="my-3 max-w-3xl whitespace-pre-wrap break-words text-sm text-[var(--hub-ink-2)]">
        {description}
      </p>
      <div className="flex flex-wrap gap-2">
        {transports.map((type) => (
          <span key={type} className="hub-tag">
            {type}
          </span>
        ))}
      </div>
      <div
        role="tablist"
        aria-label={t('registry.overview')}
        className="mt-4 flex gap-1 border-b border-[var(--hub-line)]"
        onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const current = tabs.findIndex(({ id }) => id === tab);
          const next =
            tabs[
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                  ? tabs.length - 1
                  : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length
            ].id;
          event.currentTarget.querySelector<HTMLButtonElement>(`#market-tab-${next}`)?.focus();
          setTab(next);
        }}
      >
        {tabs.map(({ id: item, label, count }) => (
          <button
            key={item}
            id={`market-tab-${item}`}
            type="button"
            role="tab"
            aria-controls={`market-panel-${item}`}
            aria-selected={tab === item}
            tabIndex={tab === item ? 0 : -1}
            className="border-b-2 border-transparent px-3 py-2 text-sm text-[var(--hub-ink-3)] aria-selected:border-[var(--hub-ink)] aria-selected:font-medium aria-selected:text-[var(--hub-ink)]"
            onClick={() => setTab(item)}
          >
            {label}
            {count > 0 && <span className="hub-mono ml-1.5 text-xs">{count}</span>}
          </button>
        ))}
      </div>
      <div
        id="market-panel-overview"
        role="tabpanel"
        aria-labelledby="market-tab-overview"
        hidden={tab !== 'overview'}
        tabIndex={0}
        className="space-y-4 pt-4"
      >
        {readmeHtml ? (
          <div
            className="skill-markdown [&_img]:inline-block [&_img]:h-auto [&_img]:max-w-full"
            dangerouslySetInnerHTML={{ __html: readmeHtml }}
          />
        ) : (
          <>
            {!!overview.length && (
              <dl className="grid gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
                {overview.map(([label, value]) => (
                  <div key={`${label}-${value}`} className="min-w-0">
                    <dt className="text-[var(--hub-ink-3)]">{label}</dt>
                    <dd className="mt-1 [overflow-wrap:anywhere]">{value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className="flex flex-wrap gap-2">
              {[
                [t('registry.website'), data.websiteUrl],
                [`${t('registry.title')} (${t('registry.official')})`, data.officialUrl],
              ].map(([label, url]) =>
                url && /^https?:\/\//i.test(url) ? (
                  <a key={label} className="hub-btn" href={url} target="_blank" rel="noreferrer">
                    {label} <ExternalLink size={14} />
                  </a>
                ) : null,
              )}
            </div>
          </>
        )}
      </div>
      <div
        id="market-panel-tools"
        role="tabpanel"
        aria-labelledby="market-tab-tools"
        hidden={tab !== 'tools'}
        tabIndex={0}
        className="space-y-3 pt-4"
      >
        {!data.tools?.length && (
          <p className="text-sm text-[var(--hub-ink-3)]">{t('registry.toolsNotIndexed')}</p>
        )}
        {data.tools?.map((tool) => (
          <details key={tool.name} className="hub-card p-4">
            <summary className="hub-mono cursor-pointer break-all">{tool.name}</summary>
            {tool.description && (
              <p className="mt-2 whitespace-pre-wrap break-words text-[var(--hub-ink-2)]">
                {tool.description}
              </p>
            )}
            {tool.inputSchema && (
              <>
                <h3 className="mt-3 text-sm font-medium">{t('cloud.parameters')}</h3>
                <pre className="hub-mono mt-2 overflow-x-auto text-sm">
                  {JSON.stringify(tool.inputSchema, null, 2)}
                </pre>
              </>
            )}
          </details>
        ))}
      </div>
      {!!parameters.length && (
        <div
          id="market-panel-parameters"
          role="tabpanel"
          aria-labelledby="market-tab-parameters"
          hidden={tab !== 'parameters'}
          tabIndex={0}
          className="pt-4"
        >
          <dl className="divide-y divide-[var(--hub-line)] text-sm">
            {parameters.map(([key, argument]) => (
              <div
                key={key}
                className="grid gap-x-5 gap-y-1.5 py-3 first:pt-0 last:pb-0 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]"
              >
                <dt className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                  <code className="hub-mono min-w-0 [overflow-wrap:anywhere]">{key}</code>
                  {argument.required && (
                    <span className="hub-tag whitespace-nowrap">{t('market.required')}</span>
                  )}
                </dt>
                <dd className="min-w-0 [overflow-wrap:anywhere] text-[var(--hub-ink-2)]">
                  {argument.description}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
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

function HostedMarketList({ filters, hidden }: { filters: URLSearchParams; hidden: boolean }) {
  const { t } = useTranslation();
  const [, setFilters] = useSearchParams();
  const q = filters.get('q') ?? '';
  const category = filters.get('category') ?? '';
  const transport = filters.get('transport') ?? '';
  const page = Math.max(1, parseInt(filters.get('page') ?? '1', 10) || 1);
  const pageSize =
    MARKET_PAGE_SIZE_OPTIONS.find((size) => size === Number(filters.get('pageSize'))) ??
    DEFAULT_PAGE_SIZE;
  const query = new URLSearchParams({
    q,
    category,
    transport,
    page: String(page),
    pageSize: String(pageSize),
  });
  const { data, loading } = useCatalog<CatalogPage>(`${CATALOG}?${query}`, !hidden);
  const { data: categories, loading: categoriesLoading } = useCatalog<CatalogCategory[]>(
    `${CATALOG}/categories`,
    !hidden,
  );

  const showFeatured = !hidden && !q && !category && !transport && page === 1;
  const [featured, setFeatured] = useState<CatalogServer[]>([]);

  useEffect(() => {
    if (hidden) return;
    let active = true;
    const refresh = async () => {
      const response = await apiGet<ApiResponse<{ server: CatalogServer; endsAt?: string }[]>>(
        `${CATALOG}/featured`,
        { cache: 'no-store' },
      );
      if (!active) return;
      const placements = response.success && Array.isArray(response.data) ? response.data : [];
      setFeatured(placements
        .filter(({ endsAt }) => endsAt === undefined || Date.parse(endsAt) > Date.now())
        .map(({ server }) => server));
    };

    void refresh();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [hidden]);

  const featuredPaths = new Set(featured.map(registryPath));
  const items = new Map<string, CatalogServer>();
  for (const server of showFeatured ? featured : []) items.set(registryPath(server), server);
  for (const server of data?.items ?? []) items.set(registryPath(server), server);

  const renderCard = ([path, server]: [string, CatalogServer]) => {
    const next = new URLSearchParams(filters);
    next.set('entry', `${server.author}/${server.name}`);
    return (
      <MarketServerCard
        key={path}
        to={`/market?${next}`}
        server={{
          name: server.name,
          display_name: server.displayName,
          author: { name: server.author },
          description: server.description,
          categories: server.categories.map(
            (slug) => categories?.find((category) => category.slug === slug)?.name ?? slug,
          ),
          tags: server.tags,
        }}
        stars={server.github.stars}
        toolCount={server.toolCount}
        transports={server.transports}
        featured={featuredPaths.has(path)}
      />
    );
  };

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
    <div hidden={hidden}>
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
          <Link
            className="hub-btn ghost"
            to={pageSize === DEFAULT_PAGE_SIZE ? '/market' : `/market?pageSize=${pageSize}`}
          >
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
          {items.size > 0 && <div className={CARD_GRID}>{Array.from(items, renderCard)}</div>}
          {loading ? (
            <MarketGridSkeleton />
          ) : !data ? (
            <p role="alert">{t('registry.fetchError')}</p>
          ) : (
            <>
              {items.size === 0 && <p role="status">{t('registry.noServers')}</p>}
              {data.total > 0 && (
                <div className="mt-5 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 text-xs text-[var(--hub-ink-3)] xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                  {data.items.length > 0 && (
                    <p className="col-start-1 row-start-1" role="status">
                      {t('registry.showing', {
                        from: (data.page - 1) * data.pageSize + 1,
                        to: (data.page - 1) * data.pageSize + data.items.length,
                        total: data.total.toLocaleString(),
                      })}
                    </p>
                  )}
                  <Pagination
                    className="col-span-2 row-start-2 xl:col-span-1 xl:col-start-2 xl:row-start-1"
                    currentPage={data.page}
                    totalPages={Math.ceil(data.total / data.pageSize)}
                    onPageChange={(nextPage) => {
                      update('page', String(nextPage));
                      window.scrollTo({ top: 0 });
                    }}
                  />
                  <label className="col-start-2 row-start-1 flex items-center justify-self-end gap-2 whitespace-nowrap xl:col-start-3">
                    {t('registry.perPage')}
                    <span className="w-[70px]">
                      <select
                        className="hub-input"
                        value={pageSize}
                        onChange={(event) => update('pageSize', event.target.value)}
                      >
                        {MARKET_PAGE_SIZE_OPTIONS.map((size) => (
                          <option key={size} value={size}>
                            {size}
                          </option>
                        ))}
                      </select>
                    </span>
                  </label>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function HostedMarket() {
  const { t } = useTranslation();
  const [filters] = useSearchParams();
  const listFilters = new URLSearchParams(filters);
  listFilters.delete('entry');
  const identity = filters.get('entry')?.split('/');
  let detail;
  if (identity) {
    const entry =
      identity.length === 2 && identity.every((slug) => /^[a-z\d][a-z\d._-]{0,127}$/i.test(slug))
        ? identity.map(encodeURIComponent).join('/')
        : undefined;
    detail = (
      <>
        <Link className="hub-btn ghost mb-4" to={`/market?${listFilters}`}>
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

  return (
    <>
      <HostedMarketList filters={listFilters} hidden={Boolean(identity)} />
      {detail}
    </>
  );
}
