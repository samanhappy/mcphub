import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, Edit, Key, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { Switch } from '@/components/ui/ToggleGroup';
import { MultiSelect } from '@/components/ui/MultiSelect';
import ConfirmDialog from '@/components/ui/ConfirmDialog';
import ResetBearerKeyDialog from '@/components/ResetBearerKeyDialog';
import { useToast } from '@/contexts/ToastContext';
import { useRuntimeSettings, useSettingsActions } from '@/hooks/useSettingsData';
import { useSettingsDraft } from '@/hooks/useSettingsDraft';
import { getRuntimeConfig } from '@/utils/runtime';
import { copyText } from '@/utils/clipboard';
import {
  filterBearerKeysByScopeFilter,
  getBearerKeyScopeFilterOptions,
  type BearerKeyScopeFilterValue,
} from '@/utils/bearerKeyScopeFilter';
import type { BearerKey, Group, Server, User } from '@/types';
import {
  SettingsAlert,
  SettingsCard,
  SettingsRow,
  SettingsSaveBar,
  SettingsStatusBadge,
  SettingsToggleRow,
  settingsInputClass,
  settingsSelectClass,
} from './SettingsPrimitives';

const parseCommaSeparated = (value: string): string[] | undefined => {
  const parts = value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return parts.length > 0 ? parts : undefined;
};

interface BearerKeyRowProps {
  keyData: BearerKey;
  busy: boolean;
  availableServers: { value: string; label: string }[];
  availableGroups: { value: string; label: string }[];
  isAdmin: boolean;
  onSave: (
    id: string,
    payload: {
      name: string;
      enabled: boolean;
      accessType: 'all' | 'groups' | 'servers' | 'custom' | 'exclude';
      allowedGroups: string;
      allowedServers: string;
      excludedGroups: string;
      excludedServers: string;
    },
  ) => Promise<void>;
  onRequestDelete: (key: BearerKey) => void;
  onReset: (key: BearerKey) => void;
  onEditingChange: (id: string, editing: boolean) => void;
}

const BearerKeyRow: React.FC<BearerKeyRowProps> = ({
  keyData,
  busy,
  availableServers,
  availableGroups,
  isAdmin,
  onSave,
  onRequestDelete,
  onReset,
  onEditingChange,
}) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [isEditing, setIsEditing] = useState(false);
  const [name, setName] = useState(keyData.name);
  const [enabled, setEnabled] = useState<boolean>(keyData.enabled);
  const [accessType, setAccessType] = useState<'all' | 'groups' | 'servers' | 'custom' | 'exclude'>(
    keyData.accessType || 'all',
  );
  const [selectedGroups, setSelectedGroups] = useState<string[]>(keyData.allowedGroups || []);
  const [selectedServers, setSelectedServers] = useState<string[]>(keyData.allowedServers || []);
  const [excludedGroups, setExcludedGroups] = useState<string[]>(keyData.excludedGroups || []);
  const [excludedServers, setExcludedServers] = useState<string[]>(keyData.excludedServers || []);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    onEditingChange(keyData.id, isEditing);
    return () => onEditingChange(keyData.id, false);
  }, [keyData.id, isEditing, onEditingChange]);

  useEffect(() => {
    if (!isEditing) {
      setName(keyData.name);
      setEnabled(keyData.enabled);
      setAccessType(keyData.accessType || 'all');
      setSelectedGroups(keyData.allowedGroups || []);
      setSelectedServers(keyData.allowedServers || []);
      setExcludedGroups(keyData.excludedGroups || []);
      setExcludedServers(keyData.excludedServers || []);
    }
  }, [keyData, isEditing]);

  const isSystemKey = (keyData.kind ?? 'system') === 'system';

  const handleSave = async () => {
    if (accessType === 'groups' && selectedGroups.length === 0) {
      showToast(t('settings.selectAtLeastOneGroup') || 'Please select at least one group', 'error');
      return;
    }
    if (isSystemKey && accessType === 'servers' && selectedServers.length === 0) {
      showToast(
        t('settings.selectAtLeastOneServer') || 'Please select at least one server',
        'error',
      );
      return;
    }
    if (
      isSystemKey &&
      accessType === 'custom' &&
      selectedGroups.length === 0 &&
      selectedServers.length === 0
    ) {
      showToast(
        t('settings.selectAtLeastOneGroupOrServer') || 'Please select at least one group or server',
        'error',
      );
      return;
    }
    if (
      isSystemKey &&
      accessType === 'exclude' &&
      excludedGroups.length === 0 &&
      excludedServers.length === 0
    ) {
      showToast(
        t('settings.selectAtLeastOneExcludedGroupOrServer') ||
          'Please select at least one group or server to exclude',
        'error',
      );
      return;
    }

    setSaving(true);
    try {
      await onSave(keyData.id, {
        name,
        enabled,
        accessType,
        allowedGroups: selectedGroups.join(', '),
        allowedServers: selectedServers.join(', '),
        excludedGroups: excludedGroups.join(', '),
        excludedServers: excludedServers.join(', '),
      });
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const isGroupsMode = accessType === 'groups' || !isSystemKey;
  const isCustomMode = accessType === 'custom';
  const isExcludeMode = accessType === 'exclude';

  const formatAccessTypeDisplay = (key: BearerKey): string => {
    if ((key.kind ?? 'system') === 'user' && key.accessType === 'all') {
      return `${t('settings.bearerKeyAccessUserVisibility') || 'User visibility'}${key.owner ? ` · ${key.owner}` : ''}`;
    }
    if (key.accessType === 'all') {
      return t('settings.bearerKeyAccessAll') || 'All Resources';
    }
    if (key.accessType === 'groups') {
      return `${t('settings.bearerKeyAccessGroups') || 'Groups'}: ${(key.allowedGroups ?? [])
        .map((id) => availableGroups.find((group) => group.value === id)?.label ?? id)
        .join(', ')}`;
    }
    if (key.accessType === 'servers') {
      return `${t('settings.bearerKeyAccessServers') || 'Servers'}: ${key.allowedServers}`;
    }
    if (key.accessType === 'custom') {
      const parts: string[] = [];
      if (key.allowedGroups && key.allowedGroups.length > 0) {
        parts.push(`${t('settings.bearerKeyAccessGroups') || 'Groups'}: ${key.allowedGroups}`);
      }
      if (key.allowedServers && key.allowedServers.length > 0) {
        parts.push(`${t('settings.bearerKeyAccessServers') || 'Servers'}: ${key.allowedServers}`);
      }
      return `${t('settings.bearerKeyAccessCustom') || 'Custom'}: ${parts.join('; ')}`;
    }
    if (key.accessType === 'exclude') {
      const parts: string[] = [];
      if (key.excludedGroups && key.excludedGroups.length > 0) {
        parts.push(
          `${t('settings.bearerKeyExcludedGroups') || 'Excluded groups'}: ${key.excludedGroups}`,
        );
      }
      if (key.excludedServers && key.excludedServers.length > 0) {
        parts.push(
          `${t('settings.bearerKeyExcludedServers') || 'Excluded servers'}: ${key.excludedServers}`,
        );
      }
      return `${t('settings.bearerKeyAccessExclude') || 'All except'}: ${parts.join('; ')}`;
    }
    return '';
  };

  return (
    <>
      <tr className="transition-colors hover:bg-[var(--hub-surface-hover)]">
        <td className="whitespace-nowrap px-4 py-3 text-[13px] font-medium text-[var(--hub-ink)]">
          {keyData.name}
        </td>
        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-[var(--hub-ink-2)]">
          {keyData.token}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-xs">
          <SettingsStatusBadge active={keyData.enabled} />
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-xs text-[var(--hub-ink-2)]">
          {formatAccessTypeDisplay(keyData)}
        </td>
        <td className="whitespace-nowrap px-4 py-3 text-right">
          <div className="inline-flex items-center gap-1">
            <button
              type="button"
              onClick={() => setIsEditing((editing) => !editing)}
              disabled={busy || saving}
              aria-expanded={isEditing}
              aria-label={t(isEditing ? 'common.cancel' : 'common.edit')}
              className="hub-icon-btn sm"
              title={t(isEditing ? 'common.cancel' : 'common.edit')}
            >
              {isEditing ? <X size={14} /> : <Edit size={14} />}
            </button>
            <button
              type="button"
              onClick={() => onReset(keyData)}
              disabled={busy || saving}
              className="hub-icon-btn sm"
              title={t('settings.resetBearerKey')}
              aria-label={t('settings.resetBearerKey')}
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              onClick={() => onRequestDelete(keyData)}
              disabled={busy || saving}
              className="hub-icon-btn sm text-[var(--hub-err)]"
              title={t('common.delete') || 'Delete'}
              aria-label={t('common.delete') || 'Delete'}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </td>
      </tr>

      {isEditing && (
        <tr>
          <td colSpan={5} className="border-b border-[var(--hub-line)] bg-[var(--hub-bg-2)] p-4">
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
                <div className="md:col-span-4">
                  <label className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]">
                    {t('settings.bearerKeyName') || 'Name'}
                  </label>
                  <input
                    type="text"
                    className={settingsInputClass}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={busy || saving}
                  />
                </div>
                <div className="md:col-span-8">
                  <label className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]">
                    {t('settings.bearerKeyToken') || 'Token'}
                  </label>
                  <div className="hub-mono flex h-8 items-center rounded-[7px] border border-[var(--hub-line)] bg-[var(--hub-surface)] px-2.5 text-xs text-[var(--hub-ink-3)]">
                    {keyData.token}
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap items-end gap-4">
                <div className="w-40">
                  <label className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]">
                    {t('settings.bearerKeyEnabled') || 'Status'}
                  </label>
                  <div className="flex h-8 items-center justify-between rounded-[7px] border border-[var(--hub-line)] bg-[var(--hub-surface)] px-2.5">
                    <span className="text-xs text-[var(--hub-ink-2)]">
                      {enabled ? t('common.active') : t('common.inactive')}
                    </span>
                    <Switch
                      size="compact"
                      disabled={busy || saving}
                      checked={enabled}
                      onCheckedChange={(checked) => setEnabled(checked)}
                    />
                  </div>
                </div>

                <div className="w-52">
                  <label className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]">
                    {t('settings.bearerKeyAccessType') || 'Access scope'}
                  </label>
                  <select
                    className={settingsSelectClass}
                    value={accessType}
                    onChange={(e) =>
                      setAccessType(
                        e.target.value as 'all' | 'groups' | 'servers' | 'custom' | 'exclude',
                      )
                    }
                    disabled={busy || saving}
                  >
                    <option value="all">
                      {t(
                        isSystemKey
                          ? 'settings.bearerKeyAccessAll'
                          : 'settings.bearerKeyAccessUserVisibility',
                      )}
                    </option>
                    <option value="groups">
                      {t('settings.bearerKeyAccessGroups') || 'Specific Groups'}
                    </option>
                    {isSystemKey && (
                      <>
                        <option value="servers">
                          {t('settings.bearerKeyAccessServers') || 'Specific Servers'}
                        </option>
                        <option value="custom">
                          {t('settings.bearerKeyAccessCustom') || 'Custom (Groups & Servers)'}
                        </option>
                        <option value="exclude">
                          {t('settings.bearerKeyAccessExclude') ||
                            'All except selected groups/servers'}
                        </option>
                      </>
                    )}
                  </select>
                </div>

                {!isSystemKey && (
                  <p className="w-full text-xs text-[var(--hub-ink-3)]">
                    {t('settings.bearerKeyPersonalScopeHint')}
                  </p>
                )}

                {!isCustomMode && !isExcludeMode && (
                  <div className="min-w-[200px] flex-1">
                    <label
                      className={`mb-1 block text-xs font-medium ${accessType === 'all' ? 'text-[var(--hub-ink-3)]' : 'text-[var(--hub-ink-2)]'}`}
                    >
                      {isGroupsMode
                        ? t('settings.bearerKeyAllowedGroups') || 'Allowed groups'
                        : t('settings.bearerKeyAllowedServers') || 'Allowed servers'}
                    </label>
                    <MultiSelect
                      options={isGroupsMode ? availableGroups : availableServers}
                      selected={isGroupsMode ? selectedGroups : selectedServers}
                      onChange={isGroupsMode ? setSelectedGroups : setSelectedServers}
                      placeholder={
                        isGroupsMode
                          ? t('settings.selectGroups') || 'Select groups...'
                          : t('settings.selectServers') || 'Select servers...'
                      }
                      disabled={busy || saving || accessType === 'all'}
                    />
                  </div>
                )}

                {isAdmin && isSystemKey && isCustomMode && (
                  <>
                    <div className="min-w-[200px] flex-1">
                      <label className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]">
                        {t('settings.bearerKeyAllowedGroups') || 'Allowed groups'}
                      </label>
                      <MultiSelect
                        options={availableGroups}
                        selected={selectedGroups}
                        onChange={setSelectedGroups}
                        placeholder={t('settings.selectGroups') || 'Select groups...'}
                        disabled={busy || saving}
                      />
                    </div>
                    <div className="min-w-[200px] flex-1">
                      <label className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]">
                        {t('settings.bearerKeyAllowedServers') || 'Allowed servers'}
                      </label>
                      <MultiSelect
                        options={availableServers}
                        selected={selectedServers}
                        onChange={setSelectedServers}
                        placeholder={t('settings.selectServers') || 'Select servers...'}
                        disabled={busy || saving}
                      />
                    </div>
                  </>
                )}

                {isAdmin && isSystemKey && isExcludeMode && (
                  <>
                    <div className="min-w-[200px] flex-1">
                      <label className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]">
                        {t('settings.bearerKeyExcludedGroups') || 'Excluded groups'}
                      </label>
                      <MultiSelect
                        options={availableGroups}
                        selected={excludedGroups}
                        onChange={setExcludedGroups}
                        placeholder={t('settings.selectGroups') || 'Select groups...'}
                        disabled={busy || saving}
                      />
                    </div>
                    <div className="min-w-[200px] flex-1">
                      <label className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]">
                        {t('settings.bearerKeyExcludedServers') || 'Excluded servers'}
                      </label>
                      <MultiSelect
                        options={availableServers}
                        selected={excludedServers}
                        onChange={setExcludedServers}
                        placeholder={t('settings.selectServers') || 'Select servers...'}
                        disabled={busy || saving}
                      />
                    </div>
                  </>
                )}

                <div className="ml-auto flex items-center gap-2">
                  <button type="button" onClick={() => setIsEditing(false)} className="hub-btn">
                    {t('common.cancel') || 'Cancel'}
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={busy || saving}
                    className="hub-btn primary"
                  >
                    {saving ? t('common.saving') || 'Saving...' : t('common.save') || 'Save'}
                  </button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

interface BearerKeysSectionProps {
  isAdmin: boolean;
  users: User[];
  servers: Server[];
  groups: Group[];
  highlightedSection?: string | null;
  onDirtyChange?: (sectionId: string, dirty: boolean) => void;
}

export const BearerKeysSection: React.FC<BearerKeysSectionProps> = ({
  isAdmin,
  users,
  servers,
  groups,
  highlightedSection,
  onDirtyChange,
}) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { routingConfig, initialLoading } = useRuntimeSettings();
  const {
    bearerKeys,
    isSectionSaving,
    updateRoutingConfig,
    createBearerKey,
    updateBearerKey,
    deleteBearerKey,
    refreshBearerKeys,
  } = useSettingsActions();

  const [showAddBearerKeyForm, setShowAddBearerKeyForm] = useState(false);
  const [editingKeyIds, setEditingKeyIds] = useState<Set<string>>(() => new Set());
  const [keyToReset, setKeyToReset] = useState<BearerKey | null>(null);
  const [keyToDelete, setKeyToDelete] = useState<BearerKey | null>(null);
  const [createdBearerToken, setCreatedBearerToken] = useState('');
  const [copiedNewToken, setCopiedNewToken] = useState(false);
  const [bearerKeyScopeFilter, setBearerKeyScopeFilter] =
    useState<BearerKeyScopeFilterValue>('all');

  const [newBearerKey, setNewBearerKey] = useState<{
    name: string;
    enabled: boolean;
    kind: 'system' | 'user';
    owner: string;
    accessType: 'all' | 'groups' | 'servers' | 'custom' | 'exclude';
  }>({
    name: '',
    enabled: true,
    kind: 'system',
    owner: '',
    accessType: 'all',
  });
  const [newSelectedGroups, setNewSelectedGroups] = useState<string[]>([]);
  const [newSelectedServers, setNewSelectedServers] = useState<string[]>([]);
  const [newSelectedExcludedGroups, setNewSelectedExcludedGroups] = useState<string[]>([]);
  const [newSelectedExcludedServers, setNewSelectedExcludedServers] = useState<string[]>([]);

  const remoteHeader = useMemo(
    () => ({ bearerAuthHeaderName: routingConfig.bearerAuthHeaderName }),
    [routingConfig.bearerAuthHeaderName],
  );
  const headerDraft = useSettingsDraft(remoteHeader);

  const handleRowEditingChange = useCallback((id: string, editing: boolean) => {
    setEditingKeyIds((prev) => {
      const has = prev.has(id);
      if (has === editing) return prev;
      const next = new Set(prev);
      if (editing) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const hasNewKeyDraft =
    showAddBearerKeyForm &&
    (newBearerKey.name.trim().length > 0 ||
      newBearerKey.owner.length > 0 ||
      newBearerKey.kind !== 'system' ||
      newBearerKey.accessType !== 'all' ||
      !newBearerKey.enabled ||
      newSelectedGroups.length > 0 ||
      newSelectedServers.length > 0 ||
      newSelectedExcludedGroups.length > 0 ||
      newSelectedExcludedServers.length > 0);

  const sectionDirty = headerDraft.dirty || editingKeyIds.size > 0 || hasNewKeyDraft;

  useEffect(() => {
    onDirtyChange?.('bearer-keys', sectionDirty);
    return () => onDirtyChange?.('bearer-keys', false);
  }, [sectionDirty, onDirtyChange]);

  const bearerKeyScopeFilterOptions = useMemo(
    () => getBearerKeyScopeFilterOptions(t, bearerKeys, users),
    [t, bearerKeys, users],
  );

  const filteredBearerKeys = useMemo(
    () => filterBearerKeysByScopeFilter(bearerKeys, bearerKeyScopeFilter),
    [bearerKeys, bearerKeyScopeFilter],
  );

  useEffect(() => {
    if (!bearerKeyScopeFilterOptions.some((option) => option.value === bearerKeyScopeFilter)) {
      setBearerKeyScopeFilter('all');
    }
  }, [bearerKeyScopeFilter, bearerKeyScopeFilterOptions]);

  useEffect(() => {
    if (newBearerKey.accessType !== 'groups' && newBearerKey.accessType !== 'custom') {
      setNewSelectedGroups([]);
    }
    if (newBearerKey.accessType !== 'servers' && newBearerKey.accessType !== 'custom') {
      setNewSelectedServers([]);
    }
  }, [newBearerKey.accessType]);

  const availableServers = useMemo(
    () => servers.map((server) => ({ value: server.name, label: server.name })),
    [servers],
  );
  const personalGroupOptions = useMemo(
    () => groups.map((group) => ({ value: group.id, label: group.name })),
    [groups],
  );
  const availableGroups = useMemo(
    () => groups.map((group) => ({ value: group.name, label: group.name })),
    [groups],
  );

  const usesDefaultBearerHeader =
    !routingConfig.bearerAuthHeaderName.trim() ||
    routingConfig.bearerAuthHeaderName.trim().toLowerCase() === 'authorization';

  const newUsesGroupSelector =
    newBearerKey.accessType === 'groups' || !isAdmin || newBearerKey.kind === 'user';

  const savingRouting = isSectionSaving('routing');
  const savingKeys = isSectionSaving('bearerKeys');
  const routingBusy = initialLoading || savingRouting;
  const keysBusy = initialLoading || savingKeys;

  const handleSaveHeaderName = async () => {
    const ok = await updateRoutingConfig(
      'bearerAuthHeaderName',
      headerDraft.values.bearerAuthHeaderName,
    );
    if (ok) {
      headerDraft.discard();
    }
  };

  const handleCreateBearerKey = async () => {
    if (!newBearerKey.name.trim()) {
      showToast(t('settings.bearerKeyNameRequired') || 'Name is required', 'error');
      return;
    }
    if (isAdmin && newBearerKey.kind === 'user' && !newBearerKey.owner) {
      showToast(t('settings.bearerKeyOwnerRequired') || 'Owner is required', 'error');
      return;
    }
    if (newBearerKey.accessType === 'groups' && newSelectedGroups.length === 0) {
      showToast(t('settings.selectAtLeastOneGroup') || 'Please select at least one group', 'error');
      return;
    }
    if (
      newBearerKey.kind === 'system' &&
      newBearerKey.accessType === 'servers' &&
      newSelectedServers.length === 0
    ) {
      showToast(
        t('settings.selectAtLeastOneServer') || 'Please select at least one server',
        'error',
      );
      return;
    }
    if (
      newBearerKey.kind === 'system' &&
      newBearerKey.accessType === 'custom' &&
      newSelectedGroups.length === 0 &&
      newSelectedServers.length === 0
    ) {
      showToast(
        t('settings.selectAtLeastOneGroupOrServer') || 'Please select at least one group or server',
        'error',
      );
      return;
    }
    if (
      newBearerKey.kind === 'system' &&
      newBearerKey.accessType === 'exclude' &&
      newSelectedExcludedGroups.length === 0 &&
      newSelectedExcludedServers.length === 0
    ) {
      showToast(
        t('settings.selectAtLeastOneExcludedGroupOrServer') ||
          'Please select at least one group or server to exclude',
        'error',
      );
      return;
    }

    const created = await createBearerKey({
      name: newBearerKey.name.trim(),
      enabled: newBearerKey.enabled,
      kind: isAdmin ? newBearerKey.kind : 'user',
      owner: isAdmin && newBearerKey.kind === 'user' ? newBearerKey.owner : undefined,
      accessType: newBearerKey.accessType,
      allowedGroups:
        (newBearerKey.accessType === 'groups' || newBearerKey.accessType === 'custom') &&
        newSelectedGroups.length > 0
          ? newSelectedGroups
          : undefined,
      allowedServers:
        (newBearerKey.accessType === 'servers' || newBearerKey.accessType === 'custom') &&
        newSelectedServers.length > 0
          ? newSelectedServers
          : undefined,
      excludedGroups:
        newBearerKey.accessType === 'exclude' && newSelectedExcludedGroups.length > 0
          ? newSelectedExcludedGroups
          : undefined,
      excludedServers:
        newBearerKey.accessType === 'exclude' && newSelectedExcludedServers.length > 0
          ? newSelectedExcludedServers
          : undefined,
    } as Partial<BearerKey> & Pick<BearerKey, 'name'>);

    if (!created) return;
    setCreatedBearerToken(created.token);
    setCopiedNewToken(false);
    setNewBearerKey({
      name: '',
      enabled: true,
      kind: 'system',
      owner: '',
      accessType: 'all',
    });
    setNewSelectedGroups([]);
    setNewSelectedServers([]);
    setNewSelectedExcludedGroups([]);
    setNewSelectedExcludedServers([]);
    setShowAddBearerKeyForm(false);
    await refreshBearerKeys();
  };

  const handleSaveExistingBearerKey = async (
    id: string,
    payload: {
      name: string;
      enabled: boolean;
      accessType: 'all' | 'groups' | 'servers' | 'custom' | 'exclude';
      allowedGroups: string;
      allowedServers: string;
      excludedGroups: string;
      excludedServers: string;
    },
  ) => {
    await updateBearerKey(id, {
      name: payload.name,
      enabled: payload.enabled,
      accessType: payload.accessType,
      allowedGroups: parseCommaSeparated(payload.allowedGroups),
      allowedServers: parseCommaSeparated(payload.allowedServers),
      excludedGroups: parseCommaSeparated(payload.excludedGroups),
      excludedServers: parseCommaSeparated(payload.excludedServers),
    });
    await refreshBearerKeys();
  };

  const handleConfirmDeleteKey = async () => {
    if (!keyToDelete) return;
    const id = keyToDelete.id;
    setKeyToDelete(null);
    await deleteBearerKey(id);
    await refreshBearerKeys();
  };

  return (
    <>
      <SettingsCard
        id="bearer-keys"
        title={t('settings.bearerKeysSectionTitle') || 'Bearer authentication keys'}
        description={t('settings.bearerKeysSectionDescription')}
        icon={<Key size={15} />}
        badge={
          <div className="flex items-center gap-2">
            {isAdmin && <SettingsStatusBadge active={routingConfig.enableBearerAuth} />}
            <span className="hub-tag hub-num">{bearerKeys.length}</span>
          </div>
        }
        dirty={sectionDirty}
        overflowVisible
        highlighted={highlightedSection === 'bearer-keys'}
      >
        {createdBearerToken && (
          <SettingsAlert variant="warning">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium">
                {t('settings.bearerKeyShownOnce') ||
                  'Copy this token now. It will not be shown again.'}
              </span>
              <button
                type="button"
                className="hub-btn sm"
                onClick={async () => {
                  const ok = await copyText(createdBearerToken);
                  setCopiedNewToken(ok);
                  showToast(
                    ok ? t('common.copySuccess') || 'Copied' : t('common.copyFailed'),
                    ok ? 'success' : 'error',
                  );
                }}
              >
                {copiedNewToken ? <Check size={12} /> : <Copy size={12} />}
                {copiedNewToken ? t('common.copied') : t('common.copy')}
              </button>
            </div>
            <div className="hub-mono mt-2 break-all rounded border border-amber-300/60 bg-[var(--hub-surface)] px-2.5 py-1.5 text-xs text-[var(--hub-ink)]">
              {createdBearerToken}
            </div>
          </SettingsAlert>
        )}

        {isAdmin && (
          <div className="space-y-3">
            <SettingsToggleRow
              id="enable-bearer-auth"
              label={t('settings.enableBearerAuth') || 'Enable Bearer Authentication'}
              description={t('settings.enableBearerAuthDescription')}
              checked={routingConfig.enableBearerAuth}
              disabled={routingBusy}
              onCheckedChange={(checked) => void updateRoutingConfig('enableBearerAuth', checked)}
            />

            <SettingsRow
              htmlFor="bearer-auth-header-name"
              label={t('settings.bearerAuthHeaderName')}
              description={t('settings.bearerAuthHeaderNameDescription')}
            >
              <input
                id="bearer-auth-header-name"
                type="text"
                value={headerDraft.values.bearerAuthHeaderName}
                onChange={(e) => headerDraft.setField('bearerAuthHeaderName', e.target.value)}
                placeholder={t('settings.bearerAuthHeaderNamePlaceholder')}
                className={`${settingsInputClass} mono`}
                disabled={routingBusy}
              />
            </SettingsRow>

            {headerDraft.dirty && (
              <SettingsSaveBar
                dirty={headerDraft.dirty}
                saving={savingRouting}
                disabled={initialLoading}
                onSave={handleSaveHeaderName}
                onDiscard={headerDraft.discard}
              />
            )}

            {!getRuntimeConfig().isHosted && (
              <SettingsToggleRow
                id="authorization-passthrough"
                label={t('settings.allowAuthorizationPassthrough')}
                description={t('settings.allowAuthorizationPassthroughDescription')}
                hint={
                  usesDefaultBearerHeader
                    ? t('settings.allowAuthorizationPassthroughRequirement')
                    : undefined
                }
                checked={routingConfig.allowAuthorizationPassthrough}
                disabled={
                  routingBusy ||
                  (!routingConfig.allowAuthorizationPassthrough && usesDefaultBearerHeader)
                }
                onCheckedChange={(checked) =>
                  void updateRoutingConfig('allowAuthorizationPassthrough', checked)
                }
              />
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <div className="flex flex-wrap items-center gap-2">
            {bearerKeys.length > 0 && bearerKeyScopeFilterOptions.length > 1 && (
              <>
                <label
                  htmlFor="bearer-key-scope-filter"
                  className="text-xs font-medium text-[var(--hub-ink-2)]"
                >
                  {t('settings.bearerKeyScopeFilter') || 'Filter by scope'}
                </label>
                <select
                  id="bearer-key-scope-filter"
                  className="hub-input w-auto min-w-44"
                  value={bearerKeyScopeFilter}
                  onChange={(e) =>
                    setBearerKeyScopeFilter(e.target.value as BearerKeyScopeFilterValue)
                  }
                >
                  {bearerKeyScopeFilterOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </>
            )}
          </div>

          {!showAddBearerKeyForm && (
            <button
              type="button"
              disabled={keysBusy}
              onClick={() => setShowAddBearerKeyForm(true)}
              className="hub-btn primary"
            >
              <Plus size={14} aria-hidden="true" />
              {t('settings.addBearerKey') || 'Add bearer key'}
            </button>
          )}
        </div>

        {bearerKeys.length === 0 ? (
          <div className="rounded-lg border border-dashed border-[var(--hub-line)] p-6 text-center text-xs text-[var(--hub-ink-3)]">
            {t('settings.noBearerKeys') || 'No bearer keys configured yet.'}
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-[var(--hub-line)]">
            <table className="min-w-full divide-y divide-[var(--hub-line-2)]">
              <thead className="bg-[var(--hub-bg-2)]">
                <tr>
                  <th
                    scope="col"
                    className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--hub-ink-3)]"
                  >
                    {t('settings.bearerKeyName') || 'Name'}
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--hub-ink-3)]"
                  >
                    {t('settings.bearerKeyToken') || 'Token'}
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--hub-ink-3)]"
                  >
                    {t('settings.bearerKeyEnabled') || 'Status'}
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-[var(--hub-ink-3)]"
                  >
                    {t('settings.bearerKeyAccessType') || 'Access Scope'}
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wider text-[var(--hub-ink-3)]"
                  >
                    {t('common.actions') || 'Actions'}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--hub-line-2)] bg-[var(--hub-surface)]">
                {filteredBearerKeys.map((key) => (
                  <BearerKeyRow
                    key={key.id}
                    keyData={key}
                    busy={keysBusy}
                    availableServers={availableServers}
                    availableGroups={
                      (key.kind ?? 'system') === 'system' ? availableGroups : personalGroupOptions
                    }
                    isAdmin={isAdmin}
                    onSave={handleSaveExistingBearerKey}
                    onRequestDelete={setKeyToDelete}
                    onReset={setKeyToReset}
                    onEditingChange={handleRowEditingChange}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {showAddBearerKeyForm && (
          <div className="space-y-4 rounded-lg border border-[var(--hub-line)] bg-[var(--hub-bg-2)] p-4">
            <div className="flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-[13px] font-medium text-[var(--hub-ink)]">
                <Plus size={14} className="text-[var(--hub-accent)]" aria-hidden="true" />
                {t('settings.addBearerKey') || 'Add bearer key'}
              </h3>
              <button
                type="button"
                className="hub-icon-btn sm"
                aria-label={t('common.cancel')}
                onClick={() => setShowAddBearerKeyForm(false)}
              >
                <X size={14} />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-3.5 md:grid-cols-12">
              <div className="md:col-span-4">
                <label className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]">
                  {t('settings.bearerKeyName') || 'Name'}
                </label>
                <input
                  type="text"
                  className={settingsInputClass}
                  placeholder="e.g. My API Key"
                  value={newBearerKey.name}
                  onChange={(e) =>
                    setNewBearerKey((prev) => ({ ...prev, name: e.target.value }))
                  }
                  disabled={keysBusy}
                />
              </div>
              {isAdmin && (
                <div className="md:col-span-4">
                  <label className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]">
                    {t('settings.bearerKeyKind') || 'Key type'}
                  </label>
                  <select
                    className={settingsSelectClass}
                    value={newBearerKey.kind}
                    onChange={(e) =>
                      setNewBearerKey((prev) => ({
                        ...prev,
                        kind: e.target.value as 'system' | 'user',
                        accessType: 'all',
                      }))
                    }
                    disabled={keysBusy}
                  >
                    <option value="system">
                      {t('settings.bearerKeyKindSystem') || 'System-level'}
                    </option>
                    <option value="user">{t('settings.bearerKeyKindUser') || 'User-level'}</option>
                  </select>
                </div>
              )}
              {isAdmin && newBearerKey.kind === 'user' && (
                <div className="md:col-span-4">
                  <label className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]">
                    {t('settings.bearerKeyOwner') || 'Owner'}
                  </label>
                  <select
                    className={settingsSelectClass}
                    value={newBearerKey.owner}
                    onChange={(e) =>
                      setNewBearerKey((prev) => ({ ...prev, owner: e.target.value }))
                    }
                    disabled={keysBusy}
                  >
                    <option value="">
                      {t('settings.bearerKeySelectOwner') || 'Select user...'}
                    </option>
                    {users.map((user) => (
                      <option key={user.username} value={user.username}>
                        {user.username}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-end gap-4">
              <div className="w-40">
                <label className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]">
                  {t('settings.bearerKeyEnabled') || 'Status'}
                </label>
                <div className="flex h-8 items-center justify-between rounded-[7px] border border-[var(--hub-line)] bg-[var(--hub-surface)] px-2.5">
                  <span className="text-xs text-[var(--hub-ink-2)]">
                    {newBearerKey.enabled ? t('common.active') : t('common.inactive')}
                  </span>
                  <Switch
                    size="compact"
                    disabled={keysBusy}
                    checked={newBearerKey.enabled}
                    onCheckedChange={(checked) =>
                      setNewBearerKey((prev) => ({ ...prev, enabled: checked }))
                    }
                  />
                </div>
              </div>

              <div className="w-52">
                <label className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]">
                  {t('settings.bearerKeyAccessType') || 'Access scope'}
                </label>
                <select
                  className={settingsSelectClass}
                  value={newBearerKey.accessType}
                  onChange={(e) =>
                    setNewBearerKey((prev) => ({
                      ...prev,
                      accessType: e.target.value as
                        | 'all'
                        | 'groups'
                        | 'servers'
                        | 'custom'
                        | 'exclude',
                    }))
                  }
                  disabled={keysBusy}
                >
                  <option value="all">
                    {t(
                      isAdmin && newBearerKey.kind === 'system'
                        ? 'settings.bearerKeyAccessAll'
                        : 'settings.bearerKeyAccessUserVisibility',
                    )}
                  </option>
                  <option value="groups">
                    {t('settings.bearerKeyAccessGroups') || 'Specific Groups'}
                  </option>
                  {isAdmin && newBearerKey.kind === 'system' && (
                    <>
                      <option value="servers">
                        {t('settings.bearerKeyAccessServers') || 'Specific Servers'}
                      </option>
                      <option value="custom">
                        {t('settings.bearerKeyAccessCustom') || 'Custom (Groups & Servers)'}
                      </option>
                      <option value="exclude">
                        {t('settings.bearerKeyAccessExclude') ||
                          'All except selected groups/servers'}
                      </option>
                    </>
                  )}
                </select>
              </div>

              {(!isAdmin || newBearerKey.kind === 'user') && (
                <p className="w-full text-xs text-[var(--hub-ink-3)]">
                  {t('settings.bearerKeyPersonalScopeHint')}
                </p>
              )}

              {newBearerKey.accessType !== 'custom' && newBearerKey.accessType !== 'exclude' && (
                <div className="min-w-[200px] flex-1">
                  <label
                    className={`mb-1 block text-xs font-medium ${newBearerKey.accessType === 'all' ? 'text-[var(--hub-ink-3)]' : 'text-[var(--hub-ink-2)]'}`}
                  >
                    {newUsesGroupSelector
                      ? t('settings.bearerKeyAllowedGroups') || 'Allowed groups'
                      : t('settings.bearerKeyAllowedServers') || 'Allowed servers'}
                  </label>
                  <MultiSelect
                    options={
                      newUsesGroupSelector
                        ? isAdmin && newBearerKey.kind === 'system'
                          ? availableGroups
                          : personalGroupOptions
                        : availableServers
                    }
                    selected={newUsesGroupSelector ? newSelectedGroups : newSelectedServers}
                    onChange={newUsesGroupSelector ? setNewSelectedGroups : setNewSelectedServers}
                    placeholder={
                      newUsesGroupSelector
                        ? t('settings.selectGroups') || 'Select groups...'
                        : t('settings.selectServers') || 'Select servers...'
                    }
                    disabled={keysBusy || newBearerKey.accessType === 'all'}
                  />
                </div>
              )}

              {isAdmin &&
                newBearerKey.kind === 'system' &&
                newBearerKey.accessType === 'custom' && (
                  <>
                    <div className="min-w-[200px] flex-1">
                      <label className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]">
                        {t('settings.bearerKeyAllowedGroups') || 'Allowed groups'}
                      </label>
                      <MultiSelect
                        options={availableGroups}
                        selected={newSelectedGroups}
                        onChange={setNewSelectedGroups}
                        placeholder={t('settings.selectGroups') || 'Select groups...'}
                        disabled={keysBusy}
                      />
                    </div>
                    <div className="min-w-[200px] flex-1">
                      <label className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]">
                        {t('settings.bearerKeyAllowedServers') || 'Allowed servers'}
                      </label>
                      <MultiSelect
                        options={availableServers}
                        selected={newSelectedServers}
                        onChange={setNewSelectedServers}
                        placeholder={t('settings.selectServers') || 'Select servers...'}
                        disabled={keysBusy}
                      />
                    </div>
                  </>
                )}

              {isAdmin &&
                newBearerKey.kind === 'system' &&
                newBearerKey.accessType === 'exclude' && (
                  <>
                    <div className="min-w-[200px] flex-1">
                      <label className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]">
                        {t('settings.bearerKeyExcludedGroups') || 'Excluded groups'}
                      </label>
                      <MultiSelect
                        options={availableGroups}
                        selected={newSelectedExcludedGroups}
                        onChange={setNewSelectedExcludedGroups}
                        placeholder={t('settings.selectGroups') || 'Select groups...'}
                        disabled={keysBusy}
                      />
                    </div>
                    <div className="min-w-[200px] flex-1">
                      <label className="mb-1 block text-xs font-medium text-[var(--hub-ink-2)]">
                        {t('settings.bearerKeyExcludedServers') || 'Excluded servers'}
                      </label>
                      <MultiSelect
                        options={availableServers}
                        selected={newSelectedExcludedServers}
                        onChange={setNewSelectedExcludedServers}
                        placeholder={t('settings.selectServers') || 'Select servers...'}
                        disabled={keysBusy}
                      />
                    </div>
                  </>
                )}

              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddBearerKeyForm(false)}
                  className="hub-btn"
                >
                  {t('common.cancel') || 'Cancel'}
                </button>
                <button
                  type="button"
                  onClick={handleCreateBearerKey}
                  disabled={keysBusy}
                  className="hub-btn primary"
                >
                  {t('settings.addBearerKeyButton') || 'Create Key'}
                </button>
              </div>
            </div>
          </div>
        )}
      </SettingsCard>

      {keyToReset && (
        <ResetBearerKeyDialog
          keyData={keyToReset}
          onClose={() => setKeyToReset(null)}
          onReset={async () => {
            setCreatedBearerToken('');
            await refreshBearerKeys();
          }}
        />
      )}

      <ConfirmDialog
        isOpen={keyToDelete !== null}
        onClose={() => setKeyToDelete(null)}
        onConfirm={() => void handleConfirmDeleteKey()}
        title={t('common.delete')}
        message={
          keyToDelete
            ? `${t('settings.deleteBearerKeyConfirm') || 'Delete this key?'} (${keyToDelete.name})`
            : ''
        }
        confirmText={t('common.delete')}
        variant="danger"
      />
    </>
  );
};

export default BearerKeysSection;
