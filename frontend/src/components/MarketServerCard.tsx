import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Star, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import { MarketServer } from '@/types';

interface MarketServerCardProps {
  server: Pick<
    MarketServer,
    'name' | 'display_name' | 'author' | 'description' | 'categories' | 'tags' | 'is_official'
  > &
    Partial<Pick<MarketServer, 'tools'>>;
  to: string;
  stars?: number;
  toolCount?: number;
  transports?: string[];
}

const getInitials = (name: string) =>
  name
    .split(' ')
    .map((w) => w.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);

const MarketServerCard: React.FC<MarketServerCardProps> = ({
  server,
  to,
  stars,
  toolCount,
  transports,
}) => {
  const { t } = useTranslation();
  const tags = (server.tags || []).slice(0, 3);
  const category = server.categories?.[0];
  const indexedTools = toolCount ?? server.tools?.length ?? 0;

  return (
    <Link
      to={to}
      className="hub-card flex min-w-0 flex-col transition-colors h-full overflow-hidden hover:border-[var(--hub-ink-2)]"
    >
      <div className="p-3.5 flex-1 flex flex-col gap-2.5">
        <div className="flex items-center gap-2">
          <div
            className="hub-mono"
            style={{
              width: 28,
              height: 28,
              borderRadius: 7,
              background: 'var(--hub-ink)',
              color: 'var(--hub-bg)',
              display: 'grid',
              placeItems: 'center',
              fontWeight: 600,
              fontSize: 13,
              flexShrink: 0,
            }}
          >
            {getInitials(server.display_name || server.name)[0] || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className="truncate"
                style={{ fontSize: 14, fontWeight: 500, letterSpacing: '-0.01em' }}
              >
                {server.display_name}
              </span>
              {server.is_official && (
                <span
                  className="inline-flex items-center gap-0.5"
                  style={{
                    fontSize: 10,
                    color: 'var(--hub-accent)',
                    background: 'var(--hub-accent-soft)',
                    padding: '0 5px',
                    height: 16,
                    borderRadius: 3,
                    fontWeight: 500,
                  }}
                >
                  <Check size={9} strokeWidth={2.5} />
                  {t('market.official')}
                </span>
              )}
            </div>
            <div className="hub-mono truncate" style={{ fontSize: 11, color: 'var(--hub-ink-3)' }}>
              @{server.author?.name || t('market.unknown')}
            </div>
          </div>
        </div>

        <div
          className="flex-1 line-clamp-2 break-words"
          style={{ fontSize: 12.5, color: 'var(--hub-ink-2)', lineHeight: 1.5 }}
        >
          {server.description}
        </div>

        {tags.length > 0 && (
          <div className="flex gap-1 flex-wrap">
            {tags.map((tag) => (
              <span
                key={tag}
                className="hub-tag"
                style={{
                  background: 'oklch(0.96 0.04 145)',
                  color: 'oklch(0.4 0.1 145)',
                  border: 0,
                }}
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>

      <div
        className="flex items-center justify-between px-3.5 py-2"
        style={{
          borderTop: '1px solid var(--hub-line-2)',
          background: 'var(--hub-bg-2)',
        }}
      >
        <div
          className="hub-mono flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1"
          style={{ fontSize: 11.5, color: 'var(--hub-ink-3)' }}
        >
          {stars !== undefined && stars > 0 && (
            <span className="inline-flex items-center gap-1">
              <Star size={11} /> {stars.toLocaleString()}
            </span>
          )}
          {indexedTools > 0 && (
            <span className="inline-flex items-center gap-1">
              <Zap size={11} />
              {indexedTools.toLocaleString()} {t('server.tools').toLowerCase()}
            </span>
          )}
          {category && <span className="truncate">{category}</span>}
          {transports?.map((transport) => (
            <span key={transport}>{transport}</span>
          ))}
        </div>
      </div>
    </Link>
  );
};

export default MarketServerCard;
