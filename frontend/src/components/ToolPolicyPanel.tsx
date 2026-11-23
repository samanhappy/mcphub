import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import type { ToolPolicyRule } from '../../../src/types/toolPolicy.js';
import {
  findMissingToolPolicyReferences,
  validateToolPolicies,
} from '../../../src/utils/toolPolicy.js';
import type { BearerKey, Group, Server, User } from '../types';
import ConfirmDialog from './ui/ConfirmDialog';

interface ToolPolicyPanelProps {
  nameSeparator: string;
  rules: ToolPolicyRule[] | undefined;
  loading: boolean;
  loadError: string | null;
  onRetry: () => Promise<void>;
  onSave: (rules: ToolPolicyRule[]) => Promise<boolean>;
  users: User[];
  bearerKeys: BearerKey[];
  servers: Server[];
  groups: Group[];
  defaultOpen?: boolean;
  sectionId?: string;
  highlighted?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}

const selectors = ['username', 'keyId', 'groupId', 'serverId', 'tool'] as const;
const inputClass = 'hub-input mt-1';

const ToolPolicyPanel: React.FC<ToolPolicyPanelProps> = ({
  nameSeparator,
  rules,
  loading,
  loadError,
  onRetry,
  onSave,
  users,
  bearerKeys,
  servers,
  groups,
  defaultOpen = false,
  sectionId = 'tool-policies',
  highlighted = false,
  onDirtyChange,
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState<ToolPolicyRule[] | null>(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const current = draft ?? rules ?? [];
  const busy = loading || saving;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(rules);
  const options = {
    username: users.map((user) => ({ value: user.username, label: user.username })),
    keyId: bearerKeys.map((key) => ({ value: key.id, label: key.name })),
    groupId: groups.map((group) => ({ value: group.id, label: group.name })),
    serverId: servers.flatMap((server) =>
      server.config?.id ? [{ value: server.config.id, label: server.name }] : [],
    ),
  };
  const missingReferences = findMissingToolPolicyReferences(current, {
    serverId: options.serverId.map(({ value }) => value),
    keyId: options.keyId.map(({ value }) => value),
    groupId: options.groupId.map(({ value }) => value),
  });

  const updateDraft = (next: ToolPolicyRule[] | null) => {
    setDraft(next);
    if (onDirtyChange) {
      onDirtyChange(next !== null && JSON.stringify(next) !== JSON.stringify(rules));
    }
  };

  const change = (index: number, key: keyof ToolPolicyRule, value: string) => {
    setError('');
    updateDraft(
      current.map((rule, i) => {
        if (i !== index) return rule;
        const updated = { ...rule, [key]: value };
        if (!value && key !== 'id' && key !== 'effect') delete updated[key];
        return updated;
      }),
    );
  };

  const requestSave = () => {
    try {
      validateToolPolicies(current);
      setError('');
      setConfirm(true);
    } catch {
      setError(t('settings.toolPolicies.invalid'));
    }
  };

  const save = async () => {
    setConfirm(false);
    setSaving(true);
    try {
      if (await onSave(current)) updateDraft(null);
      else setError(t('settings.toolPolicies.saveFailed'));
    } catch {
      setError(t('settings.toolPolicies.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      id={sectionId}
      data-section={sectionId}
      className={
        'hub-card overflow-hidden transition-colors ' +
        (highlighted ? 'ring-2 ring-[var(--hub-accent)] ring-offset-2 ring-offset-[var(--hub-bg)]' : '')
      }
      aria-labelledby="tool-policy-heading"
    >
      <button
        id="tool-policy-heading"
        type="button"
        className="flex w-full justify-between items-center py-3.5 px-5 text-left hover:bg-[var(--hub-surface-hover)]"
        aria-expanded={open}
        aria-controls="tool-policy-content"
        onClick={() => setOpen(!open)}
      >
        <span className="flex items-center gap-2.5 text-[14px] font-medium text-[var(--hub-ink)]">
          <ShieldCheck size={15} className="text-[var(--hub-ink-2)]" aria-hidden="true" />
          {t('settings.toolPolicies.title')}
          <span className="hub-tag hub-num">{rules?.length ?? '—'}</span>
          {dirty && <span className="hub-tag accent">{t('settings.unsavedBadge')}</span>}
        </span>
        <span className="text-[var(--hub-ink-3)]" aria-hidden="true">
          {open ? '−' : '+'}
        </span>
      </button>
      {open && (
        <div
          id="tool-policy-content"
          className="p-4 sm:p-5 border-t border-[var(--hub-line-2)] space-y-4"
        >
          <p className="text-xs leading-relaxed text-[var(--hub-ink-3)]">
            {t('settings.toolPolicies.description')}
          </p>
          <div className="rounded-lg border border-amber-300/70 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/50 p-3 text-xs leading-relaxed text-amber-900 dark:text-amber-200">
            {t('settings.toolPolicies.semantics')}
          </div>
          {missingReferences.length > 0 && (
            <div
              role="alert"
              className="rounded-lg border border-amber-300/70 bg-amber-50 dark:border-amber-700/60 dark:bg-amber-950/50 p-3 text-xs text-amber-900 dark:text-amber-200 break-all"
            >
              <p>{t('settings.toolPolicies.missingReferences')}</p>
              <ul className="list-disc pl-5 mt-1 space-y-0.5">
                {missingReferences.map(({ policyId, selector, value }, index) => (
                  <li key={index}>
                    {t('settings.toolPolicies.missingReference', { policyId, selector, value })}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {rules === undefined ? (
            <div role="status" className="text-sm text-[var(--hub-ink-2)]">
              {loadError || t('common.loading')}
              {!loading && (
                <button type="button" className="hub-btn ml-3" onClick={onRetry}>
                  {t('settings.toolPolicies.retry')}
                </button>
              )}
            </div>
          ) : (
            <>
              <fieldset disabled={busy} className="min-w-0 space-y-3.5">
                <legend className="sr-only">{t('settings.toolPolicies.title')}</legend>
                {current.length === 0 && (
                  <p className="text-sm text-[var(--hub-ink-3)]">
                    {t('settings.toolPolicies.empty')}
                  </p>
                )}
                {current.map((rule, index) => (
                  <fieldset
                    key={index}
                    className="min-w-0 rounded-lg border border-[var(--hub-line)] bg-[var(--hub-bg-2)] p-4"
                  >
                    <legend className="px-1 text-xs font-medium text-[var(--hub-ink-2)]">
                      {t('settings.toolPolicies.rule', { number: index + 1 })}
                    </legend>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5">
                      <label className="text-xs font-medium text-[var(--hub-ink-2)] min-w-0">
                        {t('settings.toolPolicies.id')}
                        <input
                          className={inputClass}
                          value={rule.id}
                          required
                          onChange={(e) => change(index, 'id', e.target.value)}
                        />
                      </label>
                      <label className="text-xs font-medium text-[var(--hub-ink-2)] min-w-0">
                        {t('settings.toolPolicies.effect')}
                        <select
                          className={inputClass}
                          value={rule.effect}
                          onChange={(e) => change(index, 'effect', e.target.value)}
                        >
                          <option value="deny">{t('settings.toolPolicies.deny')}</option>
                          <option value="allow">{t('settings.toolPolicies.allow')}</option>
                        </select>
                      </label>
                      {selectors.map((selector) => {
                        const listId = `policy-${index}-${selector}`;
                        const choices =
                          selector === 'tool'
                            ? servers
                                .filter(
                                  (server) => !rule.serverId || server.config?.id === rule.serverId,
                                )
                                .flatMap((server) =>
                                  (server.tools ?? []).map((tool) => ({
                                    value: tool.name.startsWith(`${server.name}${nameSeparator}`)
                                      ? tool.name.slice(server.name.length + nameSeparator.length)
                                      : tool.name,
                                    label: server.name,
                                  })),
                                )
                            : options[selector];
                        const selected = choices.find((option) => option.value === rule[selector]);
                        return (
                          <label key={selector} className="text-xs font-medium text-[var(--hub-ink-2)] min-w-0">
                            {t(`settings.toolPolicies.${selector}`)}
                            <input
                              className={inputClass}
                              list={listId}
                              value={rule[selector] ?? ''}
                              placeholder={t('settings.toolPolicies.any')}
                              onChange={(e) => change(index, selector, e.target.value)}
                            />
                            <datalist id={listId}>
                              {Array.from(
                                new Map(choices.map((option) => [option.value, option])).values(),
                              ).map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </datalist>
                            {selected && selector !== 'tool' && (
                              <span className="block mt-1 text-xs font-normal text-[var(--hub-ink-3)] break-all">
                                {selected.label}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                    <div className="flex justify-end mt-3">
                      <button
                        type="button"
                        className="hub-btn danger sm"
                        aria-label={t('settings.toolPolicies.deleteRule', { number: index + 1 })}
                        onClick={() => {
                          updateDraft(current.filter((_, i) => i !== index));
                          setError('');
                        }}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                        {t('common.delete')}
                      </button>
                    </div>
                  </fieldset>
                ))}
                <p className="text-xs text-[var(--hub-ink-3)]">
                  {t('settings.toolPolicies.selectorsHint')}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--hub-line-2)] pt-3.5">
                  <button
                    type="button"
                    className="hub-btn"
                    onClick={() => updateDraft([...current, { id: '', effect: 'deny' }])}
                  >
                    <Plus size={14} aria-hidden="true" />
                    {t('settings.toolPolicies.add')}
                  </button>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      className="hub-btn"
                      disabled={!dirty}
                      onClick={() => {
                        updateDraft(null);
                        setError('');
                      }}
                    >
                      {t('common.cancel')}
                    </button>
                    <button
                      type="button"
                      className="hub-btn primary"
                      disabled={!dirty}
                      onClick={requestSave}
                    >
                      {saving ? t('common.saving') : t('settings.toolPolicies.save')}
                    </button>
                  </div>
                </div>
              </fieldset>
              {dirty && (
                <p role="status" className="text-xs text-amber-700 dark:text-amber-400">
                  {t('settings.toolPolicies.unsaved')}
                </p>
              )}
              {error && (
                <p role="alert" className="text-xs text-[var(--hub-err)]">
                  {error}
                </p>
              )}
            </>
          )}
        </div>
      )}
      <ConfirmDialog
        isOpen={confirm}
        onClose={() => setConfirm(false)}
        onConfirm={save}
        title={t('settings.toolPolicies.save')}
        message={t(
          current.length ? 'settings.toolPolicies.confirm' : 'settings.toolPolicies.confirmClear',
          { count: current.length },
        )}
        confirmText={t('common.save')}
        confirmDisabled={busy}
      />
    </section>
  );
};

export default ToolPolicyPanel;
