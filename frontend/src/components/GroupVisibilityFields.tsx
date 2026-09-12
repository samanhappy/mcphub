import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Group } from '@/types';
import { apiGet } from '@/utils/fetchInterceptor';

type Access = Pick<Group, 'visibility' | 'sharedWithUsers'>;

export default function GroupVisibilityFields({
  groupId,
  value,
  onChange,
}: {
  groupId?: string;
  value: Access;
  onChange: (access: Access) => void;
}) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [isAdvancedExpanded, setIsAdvancedExpanded] = useState(false);
  useEffect(() => {
    if (!groupId || value.visibility !== 'group') return;
    let cancelled = false;
    setLoading(true);
    setError(false);
    apiGet<{ success: boolean; data?: string[] }>(
      `/groups/${encodeURIComponent(groupId)}/share-candidates`,
    )
      .then((result) => {
        if (cancelled) return;
        if (result.success && Array.isArray(result.data)) setUsers(result.data);
        else setError(true);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, value.visibility]);
  const selected = value.sharedWithUsers || [];
  const candidates = [...new Set([...users, ...selected])]
    .sort()
    .filter((username) => username.toLowerCase().includes(search.toLowerCase()));
  const selectedUsers = new Set(selected);
  const allCandidatesSelected =
    candidates.length > 0 && candidates.every((username) => selectedUsers.has(username));
  const noCandidatesSelected =
    candidates.length === 0 || candidates.every((username) => !selectedUsers.has(username));

  const toggleSharedUser = (username: string) => {
    const nextSelected = new Set(selected);
    if (nextSelected.has(username)) {
      nextSelected.delete(username);
    } else {
      nextSelected.add(username);
    }
    onChange({ sharedWithUsers: Array.from(nextSelected) });
  };

  return (
    <div className="mb-4">
      <div
        className="flex items-center justify-between cursor-pointer bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 p-3 rounded border border-gray-200 dark:border-gray-700"
        onClick={() => setIsAdvancedExpanded(!isAdvancedExpanded)}
      >
        <h3 className="text-sm font-semibold text-[var(--hub-ink)]">
          {t('server.sectionAdvanced', 'Advanced Options')}
        </h3>
        <span className="text-gray-500 text-sm">{isAdvancedExpanded ? '▼' : '▶'}</span>
      </div>

      {isAdvancedExpanded && (
        <div className="border border-gray-200 dark:border-gray-700 rounded-b p-4 bg-white dark:bg-gray-900 border-t-0">
          <label
            htmlFor="group-visibility"
            className="block text-sm font-medium mb-1.5 text-[var(--hub-ink-2)]"
          >
            {t('server.visibility')}
          </label>
          <select
            id="group-visibility"
            className="w-full py-2 px-3 form-input"
            value={value.visibility || ''}
            onChange={(event) =>
              onChange({ visibility: event.target.value as Group['visibility'] })
            }
          >
            {!value.visibility && (
              <option value="" disabled>
                {t('groups.legacyVisibility')}
              </option>
            )}
            <option value="private">{t('server.visibilityPrivate')}</option>
            <option value="group">{t('server.visibilityGroup')}</option>
            <option value="public">{t('server.visibilityPublic')}</option>
          </select>
          <p className="text-xs text-gray-500 mt-1">{t('groups.visibilityDescription')}</p>
          {!value.visibility && (
            <p className="text-sm text-amber-600">{t('groups.legacyVisibilityHint')}</p>
          )}
          {value.visibility === 'group' && (
            <div className="mt-4 rounded border border-gray-200 dark:border-gray-700 p-3">
              <div className="text-sm font-medium text-[var(--hub-ink-2)]">
                {t('server.shareWithUsers')}
              </div>
              <p className="text-xs text-gray-500 mt-1 mb-3">
                {t('server.shareWithUsersDescription')}
              </p>
              {!groupId ? (
                <p className="text-sm text-gray-500">{t('groups.shareAfterCreate')}</p>
              ) : (
                <>
                  {loading && (
                    <p className="text-sm text-gray-500">{t('server.shareCandidatesLoading')}</p>
                  )}
                  {error && (
                    <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                      {t('server.shareCandidatesError')}
                    </p>
                  )}
                  {!loading && !error && candidates.length === 0 && (
                    <p className="text-sm text-gray-500">
                      {search ? t('server.noMatchingShareUsers') : t('server.noShareCandidates')}
                    </p>
                  )}
                  {candidates.length > 0 && (
                    <>
                      <div className="mb-3 space-y-2">
                        <label
                          htmlFor="group-share-search"
                          className="block text-xs font-medium text-[var(--hub-ink-2)]"
                        >
                          {t('server.shareUserSearchLabel')}
                        </label>
                        <input
                          id="group-share-search"
                          type="search"
                          value={search}
                          onChange={(event) => setSearch(event.target.value)}
                          placeholder={t('server.shareUserSearchPlaceholder')}
                          className="w-full py-2 px-3 form-input text-sm"
                        />
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              onChange({
                                sharedWithUsers: [...new Set([...selected, ...candidates])],
                              })
                            }
                            disabled={allCandidatesSelected}
                            className="hub-btn text-sm"
                          >
                            {t('server.selectAllShareUsers')}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              onChange({
                                sharedWithUsers: selected.filter(
                                  (name) => !candidates.includes(name),
                                ),
                              })
                            }
                            disabled={noCandidatesSelected}
                            className="hub-btn text-sm"
                          >
                            {t('server.deselectAllShareUsers')}
                          </button>
                        </div>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {candidates.map((username) => (
                          <label
                            key={username}
                            className="flex items-center gap-2 rounded border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm text-[var(--hub-ink-2)]"
                          >
                            <input
                              type="checkbox"
                              checked={selectedUsers.has(username)}
                              onChange={() => toggleSharedUser(username)}
                            />
                            <span>{username}</span>
                          </label>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
