import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Eye,
  EyeOff,
  FileCode2,
  Globe,
  Plus,
  Radio,
  Terminal,
  Trash2,
} from 'lucide-react';
import type { EnvVar } from '@/types';
import type { ServerType } from '../../utils/serverFormUi';

export const FORM_CONTROL_CLASS =
  'w-full h-9 px-3 text-[13px] form-input transition-colors';

export const FORM_TEXTAREA_CLASS =
  'w-full py-2 px-3 text-[13px] form-input transition-colors';

interface SectionCardProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}

export const SectionCard: React.FC<SectionCardProps> = ({
  title,
  description,
  action,
  children,
}) => (
  <section
    className="rounded-[10px] p-4 space-y-4"
    style={{
      border: '1px solid var(--hub-line)',
      background: 'var(--hub-surface)',
    }}
  >
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-[13px] font-semibold text-[var(--hub-ink)]">{title}</h3>
        {description && (
          <p className="text-xs text-[var(--hub-ink-3)] mt-0.5 leading-relaxed">{description}</p>
        )}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
    {children}
  </section>
);

interface FieldLabelProps {
  htmlFor?: string;
  required?: boolean;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export const FieldLabel: React.FC<FieldLabelProps> = ({
  htmlFor,
  required,
  children,
  action,
  className = 'mb-1.5',
}) => (
  <div className={`flex items-center justify-between gap-2 ${className}`}>
    <label
      htmlFor={htmlFor}
      className="block text-[12.5px] font-medium text-[var(--hub-ink-2)]"
    >
      {children}
      {required && (
        <span className="ml-0.5 text-[var(--hub-err)]" aria-hidden="true">
          *
        </span>
      )}
    </label>
    {action}
  </div>
);

interface PasswordInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  inputClassName?: string;
}

export const PasswordInput: React.FC<PasswordInputProps> = ({
  inputClassName = FORM_CONTROL_CLASS,
  className = '',
  ...props
}) => {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);

  return (
    <div className={`relative ${className}`}>
      <input
        {...props}
        type={visible ? 'text' : 'password'}
        className={`${inputClassName} pr-9`}
      />
      <button
        type="button"
        onClick={() => setVisible((prev) => !prev)}
        disabled={props.disabled}
        aria-label={visible ? t('server.hideSecret', 'Hide secret') : t('server.showSecret', 'Show secret')}
        className="hub-icon-btn sm absolute right-1 top-1/2 -translate-y-1/2"
      >
        {visible ? <EyeOff size={14} /> : <Eye size={14} />}
      </button>
    </div>
  );
};

interface KeyValueListEditorProps {
  label: string;
  addLabel: string;
  items: EnvVar[];
  onAdd: () => void;
  onChange: (index: number, field: 'key' | 'value', value: string) => void;
  onRemove: (index: number) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  getRemoveAriaLabel: (index: number) => string;
  separator?: string;
}

export const KeyValueListEditor: React.FC<KeyValueListEditorProps> = ({
  label,
  addLabel,
  items,
  onAdd,
  onChange,
  onRemove,
  keyPlaceholder,
  valuePlaceholder,
  getRemoveAriaLabel,
  separator = ':',
}) => (
  <div>
    <div className="flex items-center justify-between gap-2 mb-2">
      <span className="text-[12.5px] font-medium text-[var(--hub-ink-2)]">{label}</span>
      <button type="button" onClick={onAdd} className="hub-btn sm">
        <Plus size={13} />
        {addLabel}
      </button>
    </div>
    {items.length > 0 && (
      <div className="space-y-2">
        {items.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="text"
              value={item.key}
              onChange={(e) => onChange(index, 'key', e.target.value)}
              className={`${FORM_CONTROL_CLASS} flex-1 min-w-0 hub-mono`}
              placeholder={keyPlaceholder}
            />
            <span className="text-xs text-[var(--hub-ink-3)] select-none">{separator}</span>
            <input
              type="text"
              value={item.value}
              onChange={(e) => onChange(index, 'value', e.target.value)}
              className={`${FORM_CONTROL_CLASS} flex-1 min-w-0`}
              placeholder={valuePlaceholder}
            />
            <button
              type="button"
              onClick={() => onRemove(index)}
              aria-label={getRemoveAriaLabel(index + 1)}
              className="hub-icon-btn sm flex-shrink-0 hover:text-[var(--hub-err)]"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
);

interface ArgumentListEditorProps {
  label: string;
  hint: string;
  addLabel: string;
  args: string[];
  onAdd: () => void;
  onChange: (index: number, value: string) => void;
  onRemove: (index: number) => void;
  getItemAriaLabel: (index: number) => string;
  getRemoveAriaLabel: (index: number) => string;
}

export const ArgumentListEditor: React.FC<ArgumentListEditorProps> = ({
  label,
  hint,
  addLabel,
  args,
  onAdd,
  onChange,
  onRemove,
  getItemAriaLabel,
  getRemoveAriaLabel,
}) => (
  <div>
    <div className="flex items-center justify-between gap-2 mb-1">
      <span className="text-[12.5px] font-medium text-[var(--hub-ink-2)]">{label}</span>
      <button type="button" onClick={onAdd} className="hub-btn sm">
        <Plus size={13} />
        {addLabel}
      </button>
    </div>
    <p className="text-xs text-[var(--hub-ink-3)] mb-2">{hint}</p>
    {args.length > 0 && (
      <div className="space-y-2">
        {args.map((arg, index) => (
          <div key={index} className="flex items-center gap-2">
            <input
              type="text"
              aria-label={getItemAriaLabel(index + 1)}
              value={arg}
              onChange={(e) => onChange(index, e.target.value)}
              className={`${FORM_CONTROL_CLASS} flex-1 min-w-0 hub-mono`}
            />
            <button
              type="button"
              aria-label={getRemoveAriaLabel(index + 1)}
              onClick={() => onRemove(index)}
              className="hub-icon-btn sm flex-shrink-0 hover:text-[var(--hub-err)]"
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
);

interface ServerTypeSelectorProps {
  value: ServerType;
  onChange: (type: ServerType) => void;
  isAdmin: boolean;
}

const SERVER_TYPE_OPTIONS: Array<{
  type: ServerType;
  id: string;
  labelKey: string;
  hintKey: string;
  fallbackHint: string;
  icon: typeof Terminal;
}> = [
  {
    type: 'stdio',
    id: 'server-type-stdio',
    labelKey: 'server.typeStdio',
    hintKey: 'server.typeStdioHint',
    fallbackHint: 'Local command',
    icon: Terminal,
  },
  {
    type: 'streamable-http',
    id: 'server-type-streamable-http',
    labelKey: 'server.typeStreamableHttp',
    hintKey: 'server.typeStreamableHttpHint',
    fallbackHint: 'Recommended remote',
    icon: Globe,
  },
  {
    type: 'sse',
    id: 'server-type-sse',
    labelKey: 'server.typeSse',
    hintKey: 'server.typeSseHint',
    fallbackHint: 'Legacy SSE stream',
    icon: Radio,
  },
  {
    type: 'openapi',
    id: 'server-type-openapi',
    labelKey: 'server.typeOpenapi',
    hintKey: 'server.typeOpenapiHint',
    fallbackHint: 'REST API bridge',
    icon: FileCode2,
  },
];

export const ServerTypeSelector: React.FC<ServerTypeSelectorProps> = ({
  value,
  onChange,
  isAdmin,
}) => {
  const { t } = useTranslation();

  return (
    <div role="radiogroup" aria-label={t('server.type')} className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {SERVER_TYPE_OPTIONS.map(({ type, id, labelKey, hintKey, fallbackHint, icon: Icon }) => {
        const selected = value === type;
        const disabled = type === 'stdio' && !isAdmin;

        return (
          <label
            key={type}
            htmlFor={id}
            className={`hub-server-type-option ${selected ? 'is-selected' : ''} ${disabled ? 'is-disabled' : ''}`}
          >
            <input
              type="radio"
              id={id}
              name="serverType"
              value={type}
              checked={selected}
              disabled={disabled}
              aria-describedby={disabled ? 'local-execution-permission' : undefined}
              onChange={() => onChange(type)}
              className="sr-only"
            />
            <div className="flex items-center gap-1.5 min-w-0">
              <Icon size={14} className="flex-shrink-0" />
              <span className="text-[12.5px] font-medium truncate">{t(labelKey)}</span>
            </div>
            <span className="text-[11px] text-[var(--hub-ink-3)] truncate">
              {t(hintKey, fallbackHint)}
            </span>
          </label>
        );
      })}
    </div>
  );
};
