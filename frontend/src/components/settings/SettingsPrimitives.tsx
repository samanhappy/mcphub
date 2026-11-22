import React, { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, Info } from 'lucide-react';
import { Switch } from '@/components/ui/ToggleGroup';
import { cn } from '@/utils/cn';

export interface SettingsStatusBadgeProps {
  active: boolean;
  activeLabel?: string;
  inactiveLabel?: string;
}

export const SettingsStatusBadge: React.FC<SettingsStatusBadgeProps> = ({
  active,
  activeLabel,
  inactiveLabel,
}) => {
  const { t } = useTranslation();
  return (
    <span className={cn('hub-status', active ? 'ok' : 'muted')} data-state={active ? 'on' : 'off'}>
      <span className="hub-dot" />
      <span>{active ? activeLabel || t('common.active') : inactiveLabel || t('common.inactive')}</span>
    </span>
  );
};

export interface SettingsCardProps {
  id: string;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  dirty?: boolean;
  highlighted?: boolean;
  collapsible?: boolean;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  overflowVisible?: boolean;
  children: React.ReactNode;
}

export const SettingsCard: React.FC<SettingsCardProps> = ({
  id,
  title,
  description,
  icon,
  badge,
  dirty = false,
  highlighted = false,
  collapsible = true,
  defaultOpen = true,
  open: controlledOpen,
  onOpenChange,
  overflowVisible = false,
  children,
}) => {
  const { t } = useTranslation();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isOpen = controlledOpen ?? uncontrolledOpen;
  const headingId = `${id}-heading`;
  const contentId = `${id}-content`;

  const toggle = () => {
    if (!collapsible) return;
    const next = !isOpen;
    if (controlledOpen === undefined) {
      setUncontrolledOpen(next);
    }
    onOpenChange?.(next);
  };

  return (
    <section
      id={id}
      data-section={id}
      aria-labelledby={headingId}
      className={cn(
        'hub-card transition-colors',
        overflowVisible ? 'overflow-visible' : 'overflow-hidden',
        highlighted && 'ring-2 ring-[var(--hub-accent)] ring-offset-2 ring-offset-[var(--hub-bg)]',
      )}
    >
      {collapsible ? (
        <button
          id={headingId}
          type="button"
          onClick={toggle}
          aria-expanded={isOpen}
          aria-controls={contentId}
          className={cn(
            'flex w-full items-center justify-between gap-3 px-5 py-3.5 text-left transition-colors hover:bg-[var(--hub-surface-hover)]',
            isOpen ? 'rounded-t-[9px]' : 'rounded-[9px]',
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {icon && <span className="shrink-0 text-[var(--hub-ink-2)]">{icon}</span>}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[14px] font-medium text-[var(--hub-ink)]">{title}</h2>
                {badge}
                {dirty && (
                  <span className="hub-tag accent" role="status">
                    {t('settings.unsavedBadge')}
                  </span>
                )}
              </div>
              {description && (
                <p className="mt-0.5 text-xs text-[var(--hub-ink-3)]">{description}</p>
              )}
            </div>
          </div>
          <ChevronDown
            size={15}
            aria-hidden="true"
            className={cn(
              'shrink-0 text-[var(--hub-ink-3)] transition-transform duration-150',
              isOpen && 'rotate-180',
            )}
          />
        </button>
      ) : (
        <div
          id={headingId}
          className="flex items-center justify-between gap-3 px-5 py-3.5"
        >
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {icon && <span className="shrink-0 text-[var(--hub-ink-2)]">{icon}</span>}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-[14px] font-medium text-[var(--hub-ink)]">{title}</h2>
                {badge}
                {dirty && (
                  <span className="hub-tag accent" role="status">
                    {t('settings.unsavedBadge')}
                  </span>
                )}
              </div>
              {description && (
                <p className="mt-0.5 text-xs text-[var(--hub-ink-3)]">{description}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {isOpen && (
        <div
          id={contentId}
          className="space-y-3.5 border-t border-[var(--hub-line-2)] px-5 py-4"
        >
          {children}
        </div>
      )}
    </section>
  );
};

export interface SettingsRowProps {
  label?: React.ReactNode;
  htmlFor?: string;
  description?: React.ReactNode;
  required?: boolean;
  error?: string;
  warning?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export const SettingsRow: React.FC<SettingsRowProps> = ({
  label,
  htmlFor,
  description,
  required = false,
  error,
  warning,
  className,
  children,
}) => {
  return (
    <div
      className={cn(
        'rounded-lg border border-[var(--hub-line)] bg-[var(--hub-bg-2)] px-3.5 py-3',
        error && 'border-[var(--hub-err)]',
        className,
      )}
    >
      {(label || description) && (
        <div className="mb-2">
          {label &&
            (htmlFor ? (
              <label
                htmlFor={htmlFor}
                className="block text-[13px] font-medium text-[var(--hub-ink)]"
              >
                {required && (
                  <span className="mr-1 text-[var(--hub-err)]" aria-hidden="true">
                    *
                  </span>
                )}
                {label}
              </label>
            ) : (
              <h3 className="text-[13px] font-medium text-[var(--hub-ink)]">
                {required && (
                  <span className="mr-1 text-[var(--hub-err)]" aria-hidden="true">
                    *
                  </span>
                )}
                {label}
              </h3>
            ))}
          {description && (
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--hub-ink-3)]">{description}</p>
          )}
        </div>
      )}
      {children}
      {warning && <div className="mt-2">{warning}</div>}
      {error && (
        <p role="alert" className="mt-1.5 flex items-center gap-1.5 text-xs text-[var(--hub-err)]">
          <AlertCircle size={13} className="shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
};

export interface SettingsToggleRowProps {
  id?: string;
  label: React.ReactNode;
  description?: React.ReactNode;
  hint?: React.ReactNode;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}

export const SettingsToggleRow: React.FC<SettingsToggleRowProps> = ({
  id,
  label,
  description,
  hint,
  checked,
  disabled = false,
  onCheckedChange,
  className,
}) => {
  const autoId = useId();
  const baseId = id || autoId;
  const labelId = `${baseId}-label`;
  const descId = description ? `${baseId}-desc` : undefined;
  const hintId = hint ? `${baseId}-hint` : undefined;
  const describedBy = [descId, hintId].filter(Boolean).join(' ') || undefined;

  return (
    <div
      className={cn(
        'flex items-start justify-between gap-4 rounded-lg border border-[var(--hub-line)] bg-[var(--hub-bg-2)] px-3.5 py-3',
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div id={labelId} className="text-[13px] font-medium text-[var(--hub-ink)]">
          {label}
        </div>
        {description && (
          <p id={descId} className="mt-0.5 text-xs leading-relaxed text-[var(--hub-ink-3)]">
            {description}
          </p>
        )}
        {hint && (
          <div id={hintId} className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
            {hint}
          </div>
        )}
      </div>
      <Switch
        id={id}
        aria-labelledby={labelId}
        aria-describedby={describedBy}
        className="mt-0.5 shrink-0"
        disabled={disabled}
        checked={checked}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
};

export interface SettingsSaveBarProps {
  dirty: boolean;
  saving?: boolean;
  disabled?: boolean;
  saveLabel?: string;
  onSave: () => void;
  onDiscard?: () => void;
  statusMessage?: React.ReactNode;
}

export const SettingsSaveBar: React.FC<SettingsSaveBarProps> = ({
  dirty,
  saving = false,
  disabled = false,
  saveLabel,
  onSave,
  onDiscard,
  statusMessage,
}) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--hub-line-2)] pt-3.5">
      <div className="min-w-0 text-xs">
        {statusMessage ? (
          statusMessage
        ) : dirty ? (
          <span role="status" className="text-amber-700 dark:text-amber-400">
            {t('settings.unsavedChangesHint')}
          </span>
        ) : (
          <span className="text-[var(--hub-ink-3)]">{t('settings.allChangesSaved')}</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        {onDiscard && dirty && (
          <button
            type="button"
            className="hub-btn"
            disabled={saving || disabled}
            onClick={onDiscard}
          >
            {t('settings.discardChanges')}
          </button>
        )}
        <button
          type="button"
          className={cn('hub-btn primary', saving && 'is-loading')}
          disabled={!dirty || saving || disabled}
          onClick={onSave}
        >
          {saving ? t('common.saving') : saveLabel || t('common.save')}
        </button>
      </div>
    </div>
  );
};

export interface SettingsAlertProps {
  variant?: 'info' | 'warning' | 'error' | 'success';
  children: React.ReactNode;
  className?: string;
}

export const SettingsAlert: React.FC<SettingsAlertProps> = ({
  variant = 'info',
  children,
  className,
}) => {
  const styles: Record<NonNullable<SettingsAlertProps['variant']>, string> = {
    info: 'border-transparent bg-[var(--hub-accent-soft)] text-[var(--hub-accent)]',
    warning:
      'border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-700/60 dark:bg-amber-950/50 dark:text-amber-200',
    error:
      'border-red-300/70 bg-red-50 text-red-800 dark:border-red-800/60 dark:bg-red-950/50 dark:text-red-200',
    success:
      'border-emerald-300/70 bg-emerald-50 text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/50 dark:text-emerald-200',
  };

  const icons: Record<NonNullable<SettingsAlertProps['variant']>, React.ReactNode> = {
    info: <Info size={14} className="mt-0.5 shrink-0" aria-hidden="true" />,
    warning: <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />,
    error: <AlertCircle size={14} className="mt-0.5 shrink-0" aria-hidden="true" />,
    success: <CheckCircle2 size={14} className="mt-0.5 shrink-0" aria-hidden="true" />,
  };

  return (
    <div
      role={variant === 'error' || variant === 'warning' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-xs leading-relaxed',
        styles[variant],
        className,
      )}
    >
      {icons[variant]}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
};

export const settingsInputClass = 'hub-input';
export const settingsSelectClass = 'hub-input';
export const settingsTextareaClass =
  'w-full rounded-[7px] border border-[var(--hub-line)] bg-[var(--hub-surface)] px-2.5 py-2 text-[13px] text-[var(--hub-ink)] outline-none placeholder:text-[var(--hub-ink-3)] focus:border-[var(--hub-ink-2)]';
