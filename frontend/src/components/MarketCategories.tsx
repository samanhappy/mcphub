import { useTranslation } from 'react-i18next';

interface MarketCategoriesProps {
  categories: { slug: string; name: string; count?: number }[];
  total?: number;
  selected: string;
  onSelect: (category: string) => void;
  loading?: boolean;
}

export default function MarketCategories({
  categories,
  total,
  selected,
  onSelect,
  loading = false,
}: MarketCategoriesProps) {
  const { t } = useTranslation();

  return (
    <section aria-label={t('market.categories')} aria-busy={loading}>
      <h3 className="hub-sect mb-2">{t('market.categories')}</h3>
      <div className="flex flex-wrap gap-0.5 lg:flex-col">
        {[{ slug: '', name: t('common.all'), count: total }, ...categories].map(
          ({ slug, name, count }) => (
            <button
              key={slug}
              type="button"
              aria-pressed={selected === slug}
              onClick={() => onSelect(slug)}
              className="flex min-w-0 items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-[13px] transition-colors"
              style={{
                background: selected === slug ? 'var(--hub-surface)' : 'transparent',
                color: selected === slug ? 'var(--hub-ink)' : 'var(--hub-ink-2)',
                borderColor: selected === slug ? 'var(--hub-line)' : 'transparent',
              }}
            >
              <span className="truncate">{name}</span>
              {count !== undefined && (
                <span className="hub-mono text-[11px] text-[var(--hub-ink-3)]">
                  {count.toLocaleString()}
                </span>
              )}
            </button>
          ),
        )}
        {loading && (
          <div aria-hidden="true" className="hidden motion-safe:animate-pulse lg:block">
            {[52, 36, 28, 48, 63, 42].map((width) => (
              <div key={width} className="flex h-[35.5px] items-center justify-between px-2.5">
                <span className="h-2.5 rounded bg-[var(--hub-line)]" style={{ width }} />
                <span className="h-2 w-5 rounded bg-[var(--hub-line)]" />
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
