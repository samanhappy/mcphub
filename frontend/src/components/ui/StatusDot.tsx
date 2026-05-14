import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ServerStatus } from '@/types';
import { cn } from '@/utils/cn';

export type DotKind = 'ok' | 'warn' | 'err' | 'muted';

const STATUS_TO_KIND: Record<ServerStatus, DotKind> = {
  connected: 'ok',
  connecting: 'warn',
  oauth_required: 'warn',
  disconnected: 'err',
};

const STATUS_TO_KEY: Record<ServerStatus, string> = {
  connected: 'status.online',
  connecting: 'status.connecting',
  oauth_required: 'status.oauthRequired',
  disconnected: 'status.offline',
};

interface StatusDotProps {
  kind: DotKind;
  label?: React.ReactNode;
  className?: string;
  onClick?: (e: React.MouseEvent) => void;
  title?: string;
}

export const StatusDot: React.FC<StatusDotProps> = ({ kind, label, className, onClick, title }) => (
  <span
    className={cn('hub-status', kind, onClick ? 'cursor-pointer hover:opacity-80' : '', className)}
    onClick={onClick}
    title={title}
  >
    <span className="hub-dot" />
    {label != null && <span>{label}</span>}
  </span>
);

interface ServerStatusDotProps {
  status: ServerStatus;
  enabled?: boolean;
  onAuthClick?: (e: React.MouseEvent) => void;
  className?: string;
}

export const ServerStatusDot: React.FC<ServerStatusDotProps> = ({
  status,
  enabled,
  onAuthClick,
  className,
}) => {
  const { t } = useTranslation();
  if (enabled === false) {
    return <StatusDot kind="muted" label={t('server.disable') || 'Disabled'} className={className} />;
  }
  const kind = STATUS_TO_KIND[status] ?? 'muted';
  const isOAuth = status === 'oauth_required';
  return (
    <StatusDot
      kind={kind}
      label={
        <>
          {isOAuth && <span aria-hidden>🔐</span>}
          <span>{t(STATUS_TO_KEY[status] || status)}</span>
        </>
      }
      onClick={isOAuth && onAuthClick ? onAuthClick : undefined}
      title={isOAuth ? t('status.clickToAuthorize') : undefined}
      className={className}
    />
  );
};
