import React from 'react';
import { useTranslation } from 'react-i18next';
import { Package, Globe, Check } from 'lucide-react';
import { RegistryServerEntry } from '@/types';

interface RegistryServerCardProps {
  serverEntry: RegistryServerEntry;
  onClick: (serverEntry: RegistryServerEntry) => void;
}

const formatDate = (dateString?: string) => {
  if (!dateString) return '';
  try {
    const date = new Date(dateString);
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}/${m}/${d}`;
  } catch {
    return '';
  }
};

const RegistryServerCard: React.FC<RegistryServerCardProps> = ({ serverEntry, onClick }) => {
  const { t } = useTranslation();
  const { server, _meta } = serverEntry;
  const officialMeta = _meta?.['io.modelcontextprotocol.registry/official'];
  const isLatest = officialMeta?.isLatest;
  const publishedAt = officialMeta?.publishedAt;
  const updatedAt = officialMeta?.updatedAt;
  const packageCount = server.packages?.length || 0;
  const remoteCount = server.remotes?.length || 0;
  const description = server.description
    ? server.description.length <= 150
      ? server.description
      : server.description.slice(0, 150) + '...'
    : t('registry.noDescription');

  const icon = (() => {
    if (server.icons && server.icons.length > 0) {
      const light = server.icons.find((i) => !i.theme || i.theme === 'light');
      return light || server.icons[0];
    }
    return null;
  })();

  return (
    <div
      className="hub-card flex flex-col cursor-pointer transition-colors h-full overflow-hidden"
      onClick={() => onClick(serverEntry)}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--hub-ink-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--hub-line)')}
    >
      <div className="p-3.5 flex-1 flex flex-col gap-2.5">
        <div className="flex items-start gap-2">
          {icon ? (
            <img
              src={icon.src}
              alt={server.title || server.name}
              className="rounded-md object-cover flex-shrink-0"
              style={{ width: 28, height: 28 }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div
              className="hub-mono flex-shrink-0"
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
              }}
            >
              {server.name.charAt(0).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className="truncate"
                style={{ fontSize: 14, fontWeight: 500, letterSpacing: '-0.01em' }}
              >
                {server.title || server.name}
              </span>
              {isLatest && (
                <span
                  className="inline-flex items-center gap-0.5 flex-shrink-0"
                  style={{
                    fontSize: 10,
                    color: 'oklch(0.4 0.13 145)',
                    background: 'oklch(0.95 0.05 145)',
                    padding: '0 5px',
                    height: 16,
                    borderRadius: 3,
                    fontWeight: 500,
                  }}
                >
                  <Check size={9} strokeWidth={2.5} />
                  {t('registry.latest')}
                </span>
              )}
            </div>
            <div
              className="hub-mono truncate"
              style={{ fontSize: 11, color: 'var(--hub-ink-3)' }}
            >
              {server.name} · v{server.version}
            </div>
          </div>
        </div>

        <div
          className="flex-1 line-clamp-2"
          style={{ fontSize: 12.5, color: 'var(--hub-ink-2)', lineHeight: 1.5 }}
        >
          {description}
        </div>
      </div>

      <div
        className="flex items-center justify-between px-3.5 py-2"
        style={{ borderTop: '1px solid var(--hub-line-2)', background: 'var(--hub-bg-2)' }}
      >
        <div
          className="hub-mono flex items-center gap-3"
          style={{ fontSize: 11.5, color: 'var(--hub-ink-3)' }}
        >
          {packageCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Package size={11} />
              {packageCount}
            </span>
          )}
          {remoteCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Globe size={11} />
              {remoteCount}
            </span>
          )}
          {(publishedAt || updatedAt) && <span>{formatDate(updatedAt || publishedAt)}</span>}
        </div>
        <span className="hub-mono" style={{ fontSize: 11, color: 'var(--hub-accent)' }}>
          {t('registry.viewDetails')} →
        </span>
      </div>
    </div>
  );
};

export default RegistryServerCard;
