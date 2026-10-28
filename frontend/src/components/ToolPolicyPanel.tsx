import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, ShieldCheck, Trash2 } from 'lucide-react';
import type { ToolPolicyRule } from '../../../src/types/toolPolicy.js';
import { validateToolPolicies } from '../../../src/utils/toolPolicy.js';
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
}

const selectors = ['username', 'keyId', 'groupId', 'serverId', 'tool'] as const;
const inputClass =
  'block w-full min-w-0 mt-1 py-2 px-3 border border-gray-300 rounded-md form-input text-sm';

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
}) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
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

  const change = (index: number, key: keyof ToolPolicyRule, value: string) => {
    setError('');
    setDraft(
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
      if (await onSave(current)) setDraft(null);
      else setError(t('settings.toolPolicies.saveFailed'));
    } catch {
      setError(t('settings.toolPolicies.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="hub-card mb-6 overflow-hidden" aria-labelledby="tool-policy-heading">
      <button
        id="tool-policy-heading"
        type="button"
        className="flex w-full justify-between items-center py-3 px-5 text-left hover:bg-[var(--hub-surface-hover)]"
        aria-expanded={open}
        aria-controls="tool-policy-content"
        onClick={() => setOpen(!open)}
      >
        <span className="flex items-center gap-2.5 font-medium">
          <ShieldCheck size={15} aria-hidden="true" />
          {t('settings.toolPolicies.title')}
          <span className="text-sm text-[var(--hub-ink-3)]">{rules?.length ?? '—'}</span>
        </span>
        <span aria-hidden="true">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div
          id="tool-policy-content"
          className="p-4 sm:p-6 border-t border-[var(--hub-line-2)] space-y-4"
        >
          <p className="text-sm text-[var(--hub-ink-2)]">
            {t('settings.toolPolicies.description')}
          </p>
          <div className="rounded-md bg-amber-50 dark:bg-amber-950 p-3 text-sm text-amber-900 dark:text-amber-200">
            {t('settings.toolPolicies.semantics')}
          </div>
          {rules === undefined ? (
            <div role="status" className="text-sm">
              {loadError || t('common.loading')}
              {!loading && (
                <button type="button" className="hub-btn ml-3" onClick={onRetry}>
                  {t('settings.toolPolicies.retry')}
                </button>
              )}
            </div>
          ) : (
            <>
              <fieldset disabled={busy} className="min-w-0 space-y-4">
                <legend className="sr-only">{t('settings.toolPolicies.title')}</legend>
                {current.length === 0 && (
                  <p className="text-sm text-[var(--hub-ink-2)]">
                    {t('settings.toolPolicies.empty')}
                  </p>
                )}
                {current.map((rule, index) => (
                  <fieldset
                    key={index}
                    className="min-w-0 rounded-md border border-[var(--hub-line)] p-4"
                  >
                    <legend className="px-1 text-sm font-medium">
                      {t('settings.toolPolicies.rule', { number: index + 1 })}
                    </legend>
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                      <label className="text-sm min-w-0">
                        {t('settings.toolPolicies.id')}
                        <input
                          className={inputClass}
                          value={rule.id}
                          required
                          onChange={(e) => change(index, 'id', e.target.value)}
                        />
                      </label>
                      <label className="text-sm min-w-0">
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
                          <label key={selector} className="text-sm min-w-0">
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
                              <span className="block mt-1 text-xs text-[var(--hub-ink-2)] break-all">
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
                        className="hub-btn text-red-600"
                        aria-label={t('settings.toolPolicies.deleteRule', { number: index + 1 })}
                        onClick={() => {
                          setDraft(current.filter((_, i) => i !== index));
                          setError('');
                        }}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                        {t('common.delete')}
                      </button>
                    </div>
                  </fieldset>
                ))}
                <p className="text-xs text-[var(--hub-ink-2)]">
                  {t('settings.toolPolicies.selectorsHint')}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="hub-btn"
                    onClick={() => setDraft([...current, { id: '', effect: 'deny' }])}
                  >
                    <Plus size={14} aria-hidden="true" />
                    {t('settings.toolPolicies.add')}
                  </button>
                  <button
                    type="button"
                    className="hub-btn"
                    disabled={!dirty}
                    onClick={() => {
                      setDraft(null);
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
              </fieldset>
              {dirty && (
                <p role="status" className="text-sm text-amber-700 dark:text-amber-400">
                  {t('settings.toolPolicies.unsaved')}
                </p>
              )}
              {error && (
                <p role="alert" className="text-sm text-red-600">
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
