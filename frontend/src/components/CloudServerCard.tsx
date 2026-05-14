import React from 'react';
import { useTranslation } from 'react-i18next';
import { Zap } from 'lucide-react';
import { CloudServer } from '@/types';

interface CloudServerCardProps {
  server: CloudServer;
  onClick: (server: CloudServer) => void;
}

const formatDate = (dateString: string) => {
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

const CloudServerCard: React.FC<CloudServerCardProps> = ({ server, onClick }) => {
  const { t } = useTranslation();

  const getDescription = () => {
    if (server.description && server.description.length <= 150) return server.description;
    if (server.content) {
      const lines = server.content.split('\n').filter((line) => line.trim());
      for (const line of lines) {
        if (line.length > 50 && line.length <= 150) return line;
      }
    }
    return server.description
      ? server.description.slice(0, 150) + '...'
      : t('cloud.noDescription');
  };

  return (
    <div
      className="hub-card flex flex-col cursor-pointer transition-colors h-full overflow-hidden"
      onClick={() => onClick(server)}
      onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--hub-ink-2)')}
      onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--hub-line)')}
    >
      <div className="p-3.5 flex-1 flex flex-col gap-2.5">
        <div className="flex items-start gap-2">
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
            {(server.title || server.name).charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <span
                className="truncate"
                style={{ fontSize: 14, fontWeight: 500, letterSpacing: '-0.01em' }}
              >
                {server.title || server.name}
              </span>
              <span
                className="hub-tag accent flex-shrink-0"
                style={{ fontSize: 10 }}
              >
                MCP
              </span>
            </div>
            <div
              className="hub-mono truncate"
              style={{ fontSize: 11, color: 'var(--hub-ink-3)' }}
            >
              @{server.author_name}
            </div>
          </div>
        </div>

        <div
          className="flex-1 line-clamp-2"
          style={{ fontSize: 12.5, color: 'var(--hub-ink-2)', lineHeight: 1.5 }}
        >
          {getDescription()}
        </div>
      </div>

      <div
        className="flex items-center justify-between px-3.5 py-2"
        style={{
          borderTop: '1px solid var(--hub-line-2)',
          background: 'var(--hub-bg-2)',
        }}
      >
        <div
          className="hub-mono flex items-center gap-3"
          style={{ fontSize: 11.5, color: 'var(--hub-ink-3)' }}
        >
          {server.tools && server.tools.length > 0 && (
            <span className="inline-flex items-center gap-1">
              <Zap size={11} />
              {server.tools.length} {t('server.tools').toLowerCase()}
            </span>
          )}
          {server.updated_at && <span>{formatDate(server.updated_at)}</span>}
        </div>
        <span
          className="hub-mono"
          style={{ fontSize: 11, color: 'var(--hub-accent)' }}
        >
          {t('cloud.viewDetails')} →
        </span>
      </div>
    </div>
  );
};

export default CloudServerCard;
