import React from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '../../utils/cn';

type BadgeVariant = 'default' | 'secondary' | 'outline' | 'destructive';

type BadgeProps = {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
  onClick?: () => void;
};

const badgeVariants = {
  default: 'bg-blue-500 text-white hover:bg-blue-600',
  secondary: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600',
  outline: 'bg-transparent border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800',
  destructive: 'bg-red-500 text-white hover:bg-red-600',
};

export function Badge({
  children,
  variant = 'default',
  className,
  onClick
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
        badgeVariants[variant],
        onClick ? 'cursor-pointer' : '',
        className
      )}
      onClick={onClick}
    >
      {children}
    </span>
  );
}

// For backward compatibility with existing code
export const StatusBadge = ({ status }: { status: 'connected' | 'disconnected' | 'connecting' }) => {
  const { t } = useTranslation();

  const colors = {
    connecting: 'status-badge-connecting',
    connected: 'status-badge-online',
    disconnected: 'status-badge-offline',
  };

  // Map status to translation keys
  const statusTranslations = {
    connected: 'status.online',
    disconnected: 'status.offline',
    connecting: 'status.connecting'
  };

  return (
    <span
      className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${colors[status]}`}
    >
      {t(statusTranslations[status] || status)}
    </span>
  );
};