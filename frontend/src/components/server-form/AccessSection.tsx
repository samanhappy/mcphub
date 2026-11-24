import React from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2 } from 'lucide-react';
import type { ServerFormData } from '@/types';
import UserGroupSelection from '../UserGroupSelection';
import type { ServerType } from '../../utils/serverFormUi';
import {
  FORM_CONTROL_CLASS,
  FORM_TEXTAREA_CLASS,
  SectionCard,
} from './FormPrimitives';

interface AccessSectionProps {
  formData: ServerFormData;
  setFormData: React.Dispatch<React.SetStateAction<ServerFormData>>;
  serverType: ServerType;
  shareCandidatesServer?: string | null;
  shareUserGroups: string[];
  shareCandidatesLoading: boolean;
  shareCandidatesError: boolean;
  selectableShareUsers: string[];
  filteredShareUsers: string[];
  selectedShareUsers: Set<string>;
  shareUserSearch: string;
  setShareUserSearch: React.Dispatch<React.SetStateAction<string>>;
  allFilteredShareUsersSelected: boolean;
  noFilteredShareUsersSelected: boolean;
  onToggleSharedUser: (username: string) => void;
  onSelectFilteredShareUsers: () => void;
  onDeselectFilteredShareUsers: () => void;
  onFieldMutated: () => void;
}

export const AccessSection: React.FC<AccessSectionProps> = ({
  formData,
  setFormData,
  serverType,
  shareCandidatesServer,
  shareUserGroups,
  shareCandidatesLoading,
  shareCandidatesError,
  selectableShareUsers,
  filteredShareUsers,
  selectedShareUsers,
  shareUserSearch,
  setShareUserSearch,
  allFilteredShareUsersSelected,
  noFilteredShareUsersSelected,
  onToggleSharedUser,
  onSelectFilteredShareUsers,
  onDeselectFilteredShareUsers,
  onFieldMutated,
}) => {
  const { t } = useTranslation();
  const hasUserGroups =
    shareUserGroups.length > 0 || (formData.sharedWithUserGroups?.length ?? 0) > 0;

  return (
    <div className="space-y-4">
      <SectionCard
        title={t('server.visibility', 'Visibility')}
        description={t(
          'server.visibilityDescription',
          'Controls which non-admin users can discover and call this server. Admins always have access.',
        )}
      >
        <div>
          <select
            id="visibility"
            name="visibility"
            aria-label={t('server.visibility', 'Visibility')}
            value={formData.visibility || 'private'}
            onChange={(e) => {
              onFieldMutated();
              setFormData((prev) => ({
                ...prev,
                visibility: e.target.value as 'private' | 'group' | 'public',
              }));
            }}
            className={FORM_CONTROL_CLASS}
          >
            <option value="private">
              {t('server.visibilityPrivate', 'Private — only the owner and admins')}
            </option>
            <option value="group">
              {t('server.visibilityGroup', 'Shared — selected users only')}
            </option>
            <option value="public">
              {t('server.visibilityPublic', 'Public — every authenticated user')}
            </option>
          </select>
        </div>

        {formData.visibility === 'group' && (
          <div
            className="rounded-lg p-3.5 space-y-4"
            style={{
              border: '1px solid var(--hub-line)',
              background: 'var(--hub-bg-2)',
            }}
          >
            {!shareCandidatesServer ? (
              <p className="text-xs text-[var(--hub-ink-2)]">
                {t('server.shareAfterCreate', 'Save the server before selecting users.')}
              </p>
            ) : (
              <>
                {hasUserGroups && (
                  <div className="pb-3 border-b border-[var(--hub-line-2)]">
                    <UserGroupSelection
                      options={shareUserGroups}
                      selected={formData.sharedWithUserGroups || []}
                      disabled={shareCandidatesLoading || shareCandidatesError}
                      onChange={(sharedWithUserGroups) => {
                        onFieldMutated();
                        setFormData((previous) => ({ ...previous, sharedWithUserGroups }));
                      }}
                    />
                  </div>
                )}

                <div>
                  <div className="text-[13px] font-medium text-[var(--hub-ink)]">
                    {t('server.shareWithUsers', 'Share with users')}
                  </div>
                  <p className="text-xs text-[var(--hub-ink-3)] mt-0.5 mb-3">
                    {t(
                      'server.shareWithUsersDescription',
                      'Selected users can discover and call this server, but cannot manage its configuration.',
                    )}
                  </p>

                  {shareCandidatesLoading && (
                    <p className="text-xs text-[var(--hub-ink-3)]">
                      {t('server.shareCandidatesLoading', 'Loading users...')}
                    </p>
                  )}
                  {shareCandidatesError && (
                    <p className="text-xs text-[var(--hub-err)]">
                      {t('server.shareCandidatesError', 'Failed to load users.')}
                    </p>
                  )}
                  {!shareCandidatesLoading &&
                    !shareCandidatesError &&
                    selectableShareUsers.length === 0 && (
                      <p className="text-xs text-[var(--hub-ink-3)]">
                        {t('server.noShareCandidates', 'No other users are available.')}
                      </p>
                    )}

                  {selectableShareUsers.length > 0 && (
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          id="share-user-search"
                          type="search"
                          aria-label={t('server.shareUserSearchLabel', 'Search users')}
                          value={shareUserSearch}
                          onChange={(event) => setShareUserSearch(event.target.value)}
                          placeholder={t(
                            'server.shareUserSearchPlaceholder',
                            'Search usernames...',
                          )}
                          className={`${FORM_CONTROL_CLASS} flex-1 min-w-[180px]`}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            onFieldMutated();
                            onSelectFilteredShareUsers();
                          }}
                          disabled={allFilteredShareUsersSelected}
                          className="hub-btn sm"
                        >
                          {t('server.selectAllShareUsers', 'Select all')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onFieldMutated();
                            onDeselectFilteredShareUsers();
                          }}
                          disabled={noFilteredShareUsersSelected}
                          className="hub-btn sm"
                        >
                          {t('server.deselectAllShareUsers', 'Deselect all')}
                        </button>
                      </div>

                      {filteredShareUsers.length === 0 ? (
                        <p className="text-xs text-[var(--hub-ink-3)]">
                          {t('server.noMatchingShareUsers', 'No users match your search.')}
                        </p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-0.5">
                          {filteredShareUsers.map((username) => (
                            <label
                              key={username}
                              className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-[var(--hub-ink)] cursor-pointer transition-colors"
                              style={{
                                border: '1px solid var(--hub-line)',
                                background: 'var(--hub-surface)',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={selectedShareUsers.has(username)}
                                onChange={() => {
                                  onFieldMutated();
                                  onToggleSharedUser(username);
                                }}
                              />
                              <span className="truncate">{username}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={t('credentials.slots')}
        description={t('credentials.slotsHint')}
        action={
          <button
            type="button"
            className="hub-btn sm"
            disabled={(formData.credentialTemplate?.length || 0) >= 32}
            onClick={() => {
              onFieldMutated();
              setFormData((prev) => ({
                ...prev,
                credentialTemplate: [
                  ...(prev.credentialTemplate || []),
                  { target: serverType === 'stdio' ? 'env' : 'headers', name: '' },
                ],
              }));
            }}
          >
            <Plus size={13} />
            {t('credentials.addSlot')}
          </button>
        }
      >
        {serverType === 'stdio' && (
          <p className="text-xs text-[var(--hub-ink-3)]">
            {t('credentials.argsHint', { placeholder: '{{args.API_KEY}}' })}
          </p>
        )}
        {(serverType === 'sse' || serverType === 'streamable-http') && (
          <p className="text-xs text-[var(--hub-ink-3)]">
            {t('credentials.urlHint', { placeholder: '{{url.region}}' })}
          </p>
        )}

        {(formData.credentialTemplate || []).length > 0 && (
          <div className="space-y-2.5">
            {(formData.credentialTemplate || []).map((slot, index) => (
              <div
                key={index}
                className="rounded-lg p-3 space-y-2"
                style={{
                  border: '1px solid var(--hub-line)',
                  background: 'var(--hub-bg-2)',
                }}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {serverType === 'stdio' ? (
                    <select
                      aria-label={t('credentials.target')}
                      value={slot.target === 'args' ? 'args' : 'env'}
                      className={`${FORM_CONTROL_CLASS} !w-auto min-w-[120px]`}
                      onChange={(event) => {
                        onFieldMutated();
                        setFormData((prev) => ({
                          ...prev,
                          credentialTemplate: prev.credentialTemplate?.map((item, i) =>
                            i === index
                              ? { ...item, target: event.target.value as 'env' | 'args' }
                              : item,
                          ),
                        }));
                      }}
                    >
                      <option value="env">{t('server.envVars')}</option>
                      <option value="args">{t('server.arguments')}</option>
                    </select>
                  ) : (
                    <select
                      aria-label={t('credentials.target')}
                      value={slot.target === 'url' ? 'url' : 'headers'}
                      className={`${FORM_CONTROL_CLASS} !w-auto min-w-[120px]`}
                      onChange={(event) => {
                        onFieldMutated();
                        setFormData((prev) => ({
                          ...prev,
                          credentialTemplate: prev.credentialTemplate?.map((item, i) =>
                            i === index
                              ? {
                                  ...item,
                                  target: event.target.value as 'headers' | 'url',
                                  allowed: event.target.value === 'url' ? [] : undefined,
                                }
                              : item,
                          ),
                        }));
                      }}
                    >
                      <option value="headers">{t('server.headers')}</option>
                      {(serverType === 'sse' || serverType === 'streamable-http') && (
                        <option value="url">URL</option>
                      )}
                    </select>
                  )}

                  <input
                    id={`credential-slot-name-${index}`}
                    required
                    maxLength={128}
                    aria-label={t('credentials.fieldName')}
                    placeholder={t('credentials.fieldName')}
                    value={slot.name}
                    className={`${FORM_CONTROL_CLASS} min-w-0 flex-1 hub-mono`}
                    onChange={(event) => {
                      onFieldMutated();
                      setFormData((prev) => ({
                        ...prev,
                        credentialTemplate: prev.credentialTemplate?.map((item, i) =>
                          i === index ? { ...item, name: event.target.value } : item,
                        ),
                      }));
                    }}
                  />

                  <input
                    maxLength={200}
                    aria-label={t('credentials.label')}
                    placeholder={t('credentials.label')}
                    value={slot.label || ''}
                    className={`${FORM_CONTROL_CLASS} min-w-0 flex-1`}
                    onChange={(event) => {
                      onFieldMutated();
                      setFormData((prev) => ({
                        ...prev,
                        credentialTemplate: prev.credentialTemplate?.map((item, i) =>
                          i === index ? { ...item, label: event.target.value } : item,
                        ),
                      }));
                    }}
                  />

                  <button
                    type="button"
                    aria-label={t('credentials.removeSlot')}
                    className="hub-icon-btn sm flex-shrink-0 hover:text-[var(--hub-err)]"
                    onClick={() => {
                      onFieldMutated();
                      setFormData((prev) => ({
                        ...prev,
                        credentialTemplate: prev.credentialTemplate?.filter(
                          (_, i) => i !== index,
                        ),
                      }));
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>

                {slot.target === 'url' && (
                  <textarea
                    id={`credential-slot-allowed-${index}`}
                    required
                    rows={2}
                    aria-label={t('credentials.allowed')}
                    placeholder={t('credentials.allowed')}
                    value={(slot.allowed || []).join('\n')}
                    className={`${FORM_TEXTAREA_CLASS} hub-mono text-xs`}
                    onChange={(event) => {
                      onFieldMutated();
                      setFormData((prev) => ({
                        ...prev,
                        credentialTemplate: prev.credentialTemplate?.map((item, i) =>
                          i === index
                            ? { ...item, allowed: event.target.value.split('\n') }
                            : item,
                        ),
                      }));
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </SectionCard>
    </div>
  );
};
