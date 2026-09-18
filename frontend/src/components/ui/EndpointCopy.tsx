import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useToast } from '@/contexts/ToastContext';
import { copyText } from '@/utils/clipboard';
import { cn } from '@/utils/cn';

interface EndpointCopyProps {
  url: string;
  label?: string;
  prefix?: string;
  className?: string;
  /** Optionally override the value placed on the clipboard. */
  copyValue?: string;
  ariaLabel?: string;
}

export const EndpointCopy: React.FC<EndpointCopyProps> = ({
  url,
  label,
  prefix,
  className,
  copyValue,
  ariaLabel,
}) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);

  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copyText(copyValue ?? url);
    if (!ok) {
      showToast(t('common.copyFailed') || 'Copy failed', 'error');
      return;
    }
    setCopied(true);
    showToast(t('common.copySuccess') || 'Copied to clipboard', 'success');
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <div className={cn('hub-endpoint', className)} role="group" aria-label={ariaLabel || url}>
      {label && <div className="hub-endpoint-label">{label}</div>}
      <div className="hub-endpoint-url" title={url}>
        {prefix && <span style={{ color: 'var(--hub-ink-3)' }}>{prefix}</span>}
        {url}
      </div>
      <button
        type="button"
        onClick={onCopy}
        className={cn('hub-endpoint-copy', copied ? 'copied' : '')}
        title={t('common.copy') || 'Copy'}
        aria-label={t('common.copy') || 'Copy'}
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
};

interface MonoCopyProps {
  text: string;
  className?: string;
  copyValue?: string;
  title?: string;
}

/** Inline monospace value with hover-to-copy icon. */
export const MonoCopy: React.FC<MonoCopyProps> = ({ text, className, copyValue, title }) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [copied, setCopied] = useState(false);

  const onCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copyText(copyValue ?? text);
    if (!ok) {
      showToast(t('common.copyFailed') || 'Copy failed', 'error');
      return;
    }
    setCopied(true);
    showToast(t('common.copySuccess') || 'Copied to clipboard', 'success');
    setTimeout(() => setCopied(false), 1200);
  };

  return (
    <span
      className={cn(
        'hub-mono inline-flex items-center gap-1.5 group cursor-pointer text-[12.5px]',
        className,
      )}
      onClick={onCopy}
      title={title || text}
      role="button"
    >
      <span className="truncate">{text}</span>
      {copied ? (
        <Check size={12} className="text-[var(--hub-ok)] flex-shrink-0" />
      ) : (
        <Copy
          size={12}
          className="text-[var(--hub-ink-3)] opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
        />
      )}
    </span>
  );
};
