import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertCircle } from 'lucide-react';
import type { Tool } from '@/types';
import { Switch } from './ToggleGroup';
import { useToast } from '@/contexts/ToastContext';
import { updateToolFileStaging } from '@/services/toolService';
import {
  buildParamRoleMap,
  buildStagingParamOptions,
  buildToolFileStagingPayload,
  getToolFileStagingSyncKey,
  isToolFileStagingDirty,
  type FileStagingParamRole,
} from '@/utils/fileStaging';

interface ToolFileStagingEditorProps {
  serverName: string;
  toolName: string;
  tool: Tool;
  hiddenParams: string[];
  readOnly?: boolean;
  serverHasStagingAdapter?: boolean;
  onSaved?: () => void;
}

const ROLES: readonly FileStagingParamRole[] = ['none', 'input', 'output'];

const ToolFileStagingEditor = ({
  serverName,
  toolName,
  tool,
  hiddenParams,
  readOnly = false,
  serverHasStagingAdapter = false,
  onSaved,
}: ToolFileStagingEditorProps) => {
  const { t } = useTranslation();
  const { showToast } = useToast();

  const initialEnabled = tool.fileStaging?.enabled === true;
  const syncKey = getToolFileStagingSyncKey(serverName, tool.name, tool.fileStaging);
  // Keyed on the canonical value string rather than the `tool.fileStaging`
  // object reference so background ServerContext polling does not reset
  // unsaved drafts or inline validation errors.
  const initialRoles = useMemo(
    () => buildParamRoleMap(tool.fileStaging),
    [syncKey],
  );
  const paramOptions = useMemo(
    () => buildStagingParamOptions(tool.inputSchema, tool.fileStaging, hiddenParams),
    [tool.inputSchema, tool.fileStaging, hiddenParams],
  );

  const [draftEnabled, setDraftEnabled] = useState<boolean>(initialEnabled);
  const [draftRoles, setDraftRoles] = useState<Record<string, FileStagingParamRole>>(initialRoles);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraftEnabled(initialEnabled);
    setDraftRoles(initialRoles);
    setError(null);
  }, [syncKey, initialEnabled, initialRoles]);

  const dirty = isToolFileStagingDirty(draftEnabled, draftRoles, tool.fileStaging);

  const handleRoleChange = (path: string, role: FileStagingParamRole) => {
    setError(null);
    setDraftRoles((prev) => {
      const next = { ...prev };
      if (role === 'none') {
        delete next[path];
      } else {
        next[path] = role;
      }
      return next;
    });
  };

  const handleReset = () => {
    setDraftEnabled(initialEnabled);
    setDraftRoles(initialRoles);
    setError(null);
  };

  const handleSave = async () => {
    if (readOnly || !dirty || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      const payload = buildToolFileStagingPayload(
        toolName,
        draftEnabled,
        draftRoles,
        tool.fileStaging,
      );
      const result = await updateToolFileStaging(serverName, payload);
      if (result.success) {
        showToast(t('tool.fileStagingSaveSuccess'), 'success');
        onSaved?.();
      } else {
        setError(result.error || t('tool.fileStagingSaveFailed'));
      }
    } finally {
      setIsSaving(false);
    }
  };

  const roleLabel = (role: FileStagingParamRole): string => {
    if (role === 'input') return t('tool.fileStagingRoleInput');
    if (role === 'output') return t('tool.fileStagingRoleOutput');
    return t('tool.fileStagingRoleNone');
  };

  return (
    <div
      style={{
        background: 'var(--hub-bg-2)',
        borderRadius: 7,
        padding: '8px 12px',
        border: '1px solid var(--hub-line)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2">
          <span className="hub-sect">{t('tool.fileStagingTitle')}</span>
          <Switch
            checked={draftEnabled}
            onCheckedChange={(checked) => {
              setError(null);
              setDraftEnabled(checked);
            }}
            disabled={readOnly || isSaving}
            size="card"
            aria-label={t('tool.fileStagingEnable')}
          />
          <span style={{ fontSize: 11.5, color: 'var(--hub-ink-2)' }}>
            {t('tool.fileStagingEnable')}
          </span>
        </div>

        {!readOnly && (
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className="hub-btn sm"
              disabled={!dirty || isSaving}
              onClick={handleReset}
            >
              {t('common.reset')}
            </button>
            <button
              type="button"
              className="hub-btn primary sm"
              disabled={!dirty || isSaving}
              onClick={() => void handleSave()}
            >
              {isSaving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        )}
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--hub-ink-3)', marginBottom: 8 }}>
        {t('tool.fileStagingHelp')}
      </div>

      {!serverHasStagingAdapter && (
        <div
          className="mb-2 rounded-md border px-2 py-1 text-[11.5px]"
          style={{
            borderColor: 'var(--hub-line)',
            background: 'var(--hub-surface)',
            color: 'var(--hub-warn)',
          }}
        >
          {t('tool.fileStagingRequiresAdapter')}
        </div>
      )}

      {paramOptions.length === 0 ? (
        <div style={{ fontSize: 11.5, color: 'var(--hub-ink-3)' }}>
          {t('tool.fileStagingNoParams')}
        </div>
      ) : (
        <div className="space-y-1.5">
          {paramOptions.map((option) => {
            const currentRole: FileStagingParamRole = draftRoles[option.path] ?? 'none';
            return (
              <div
                key={option.path}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-2.5 py-1.5"
                style={{
                  background: 'var(--hub-surface)',
                  borderColor: 'var(--hub-line-2)',
                }}
              >
                <div className="min-w-0 flex items-center gap-1.5 flex-wrap">
                  <span className="hub-mono text-[11.5px]" style={{ color: 'var(--hub-ink)' }}>
                    {option.path}
                    {option.required ? ' *' : ''}
                  </span>
                  {option.hidden && (
                    <span
                      className="hub-tag"
                      style={{ fontSize: 10, color: 'var(--hub-warn)' }}
                      title={t('tool.fileStagingHiddenParamHint')}
                    >
                      {t('tool.fileStagingHiddenBadge')}
                    </span>
                  )}
                  {option.stale && (
                    <span
                      className="hub-tag"
                      style={{ fontSize: 10, color: 'var(--hub-err)' }}
                      title={t('tool.fileStagingStaleParamHint')}
                    >
                      {t('tool.fileStagingStaleBadge')}
                    </span>
                  )}
                </div>

                <div
                  className="inline-flex rounded-md border overflow-hidden"
                  style={{ borderColor: 'var(--hub-line-2)' }}
                  role="group"
                  aria-label={`${option.path} ${t('tool.fileStagingDirection')}`}
                >
                  {ROLES.map((role) => {
                    const active = currentRole === role;
                    return (
                      <button
                        key={role}
                        type="button"
                        disabled={readOnly || isSaving}
                        aria-pressed={active}
                        onClick={() => handleRoleChange(option.path, role)}
                        className="px-2 py-0.5 text-[11px] transition-colors disabled:opacity-50"
                        style={{
                          background: active ? 'var(--hub-accent-soft)' : 'transparent',
                          color: active ? 'var(--hub-accent)' : 'var(--hub-ink-2)',
                          fontWeight: active ? 600 : 400,
                        }}
                      >
                        {roleLabel(role)}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-2 text-[11px]" style={{ color: 'var(--hub-ink-3)' }}>
        {t('tool.fileStagingRestartCwdNotice')}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-2 flex items-start gap-1.5 rounded-md border px-2.5 py-1.5 text-[11.5px]"
          style={{
            borderColor: 'var(--hub-err)',
            color: 'var(--hub-err)',
            background: 'var(--hub-surface)',
          }}
        >
          <AlertCircle size={13} className="mt-0.5 flex-shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};

export default ToolFileStagingEditor;
