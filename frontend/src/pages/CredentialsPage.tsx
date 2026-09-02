import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { KeyRound, RefreshCw, ShieldCheck, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CredentialBindingSummary } from '@/types';
import { useToast } from '@/contexts/ToastContext';
import {
  listCredentialBindings,
  removeCredentialBinding,
  saveCredentialBinding,
  type CredentialValues,
} from '@/services/credentialService';

type Drafts = Record<string, CredentialValues>;

const CredentialsPage = () => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [searchParams] = useSearchParams();
  const selectedServer = searchParams.get('server');
  const [bindings, setBindings] = useState<CredentialBindingSummary[]>([]);
  const [drafts, setDrafts] = useState<Drafts>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    const response = await listCredentialBindings();
    if (response.success && response.data) {
      setBindings(response.data);
    } else {
      setError(response.message || t('credentials.loadFailed'));
    }
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const orderedBindings = useMemo(
    () =>
      [...bindings].sort((left, right) => {
        if (left.serverName === selectedServer) return -1;
        if (right.serverName === selectedServer) return 1;
        return left.serverName.localeCompare(right.serverName);
      }),
    [bindings, selectedServer],
  );

  const updateDraft = (
    serverName: string,
    kind: 'env' | 'headers',
    slot: string,
    value: string,
  ) => {
    setDrafts((previous) => ({
      ...previous,
      [serverName]: {
        ...(previous[serverName] || {}),
        [kind]: { ...(previous[serverName]?.[kind] || {}), [slot]: value },
      },
    }));
  };

  const save = async (binding: CredentialBindingSummary) => {
    const draft = drafts[binding.serverName] || {};
    const values = Object.fromEntries(
      (['env', 'headers'] as const)
        .map((kind) => [
          kind,
          Object.fromEntries(
            Object.entries(draft[kind] || {}).filter(([, value]) => value.trim().length > 0),
          ),
        ])
        .filter(([, section]) => Object.keys(section as object).length > 0),
    ) as CredentialValues;
    if (Object.keys(values).length === 0) {
      showToast(t('credentials.enterValue'), 'error');
      return;
    }

    setSaving(binding.serverName);
    const response = await saveCredentialBinding(binding.serverName, values);
    setSaving(null);
    if (!response.success || !response.data) {
      showToast(response.message || t('credentials.saveFailed'), 'error');
      return;
    }
    setBindings((previous) =>
      previous.map((item) => (item.serverName === binding.serverName ? response.data! : item)),
    );
    setDrafts((previous) => ({ ...previous, [binding.serverName]: {} }));
    showToast(t('credentials.saved'), 'success');
  };

  const remove = async (binding: CredentialBindingSummary) => {
    if (!window.confirm(t('credentials.deleteConfirm', { serverName: binding.serverName }))) return;
    setSaving(binding.serverName);
    const response = await removeCredentialBinding(binding.serverName);
    setSaving(null);
    if (!response.success) {
      showToast(response.message || t('credentials.deleteFailed'), 'error');
      return;
    }
    await load();
    showToast(t('credentials.deleted'), 'success');
  };

  return (
    <div>
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="hub-h1">{t('credentials.title')}</h1>
          <p className="hub-sub">{t('credentials.subtitle')}</p>
        </div>
        <button className="hub-btn" onClick={() => void load()} disabled={loading}>
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          {t('common.refresh')}
        </button>
      </div>

      {error && <div className="hub-card p-4 mb-4 text-[var(--hub-err)]">{error}</div>}
      {loading ? (
        <div className="hub-card p-10 text-center text-[var(--hub-ink-3)]">
          {t('app.loading')}
        </div>
      ) : orderedBindings.length === 0 ? (
        <div className="hub-card p-10 text-center text-[var(--hub-ink-3)]">
          <KeyRound size={20} className="mx-auto mb-3" />
          {t('credentials.empty')}
        </div>
      ) : (
        <div className="space-y-3">
          {orderedBindings.map((binding) => (
            <section
              key={binding.serverName}
              className="hub-card p-5"
              style={
                binding.serverName === selectedServer
                  ? { borderColor: 'var(--hub-accent)' }
                  : undefined
              }
            >
              <div className="flex items-start justify-between gap-4 mb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="hub-mono text-sm text-[var(--hub-ink)]">
                      {binding.serverName}
                    </h2>
                    <span className={`hub-tag ${binding.complete ? 'accent' : ''}`}>
                      {binding.complete ? t('credentials.configured') : t('credentials.required')}
                    </span>
                  </div>
                  {binding.description && (
                    <p className="text-xs text-[var(--hub-ink-3)] mt-1">{binding.description}</p>
                  )}
                </div>
                {binding.complete && (
                  <button
                    className="hub-btn sm"
                    onClick={() => void remove(binding)}
                    disabled={saving === binding.serverName}
                  >
                    <Trash2 size={12} /> {t('common.delete')}
                  </button>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {(['env', 'headers'] as const).flatMap((kind) =>
                  Object.entries(binding.credentialTemplate[kind] || {}).map(([slot, metadata]) => (
                    <label key={`${kind}.${slot}`} className="block">
                      <span className="flex items-center justify-between gap-2 text-xs mb-1">
                        <span className="font-medium text-[var(--hub-ink-2)]">
                          {metadata.label || slot}
                        </span>
                        <span className="hub-mono text-[var(--hub-ink-3)]">
                          {kind}.{slot}
                        </span>
                      </span>
                      <input
                        type="password"
                        value={drafts[binding.serverName]?.[kind]?.[slot] || ''}
                        onChange={(event) =>
                          updateDraft(binding.serverName, kind, slot, event.target.value)
                        }
                        className="w-full py-2 px-3 form-input"
                        autoComplete="new-password"
                        placeholder={
                          binding.configured[kind]?.[slot]
                            ? t('credentials.replacePlaceholder')
                            : t('credentials.valuePlaceholder')
                        }
                      />
                    </label>
                  )),
                )}
              </div>

              <div className="flex items-center justify-between gap-3 mt-4">
                <p className="flex items-center gap-1.5 text-xs text-[var(--hub-ink-3)]">
                  <ShieldCheck size={13} /> {t('credentials.writeOnly')}
                </p>
                <button
                  className="hub-btn primary"
                  onClick={() => void save(binding)}
                  disabled={saving === binding.serverName}
                >
                  {saving === binding.serverName ? t('credentials.saving') : t('credentials.save')}
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export default CredentialsPage;
