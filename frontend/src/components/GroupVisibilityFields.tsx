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
  return (
    <div className="space-y-2">
      <label htmlFor="group-visibility" className="block text-sm font-medium">
        {t('server.visibility')}
      </label>
      <select
        id="group-visibility"
        className="w-full py-2 px-3 form-input"
        value={value.visibility || ''}
        onChange={(event) => onChange({ visibility: event.target.value as Group['visibility'] })}
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
      <p className="text-xs text-gray-500">{t('groups.visibilityDescription')}</p>
      {!value.visibility && (
        <p className="text-sm text-amber-600">{t('groups.legacyVisibilityHint')}</p>
      )}
      {value.visibility === 'group' && (
        <div className="space-y-2 rounded border p-3">
          <div className="text-sm font-medium">{t('server.shareWithUsers')}</div>
          {!groupId ? (
            <p className="text-sm text-gray-500">{t('groups.shareAfterCreate')}</p>
          ) : (
            <>
              {loading && <p>{t('server.shareCandidatesLoading')}</p>}
              {error && (
                <p role="alert" className="text-red-600">
                  {t('server.shareCandidatesError')}
                </p>
              )}
              <label htmlFor="group-share-search" className="block text-sm">
                {t('server.shareUserSearchLabel')}
              </label>
              <input
                id="group-share-search"
                type="search"
                className="w-full form-input"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t('server.shareUserSearchPlaceholder')}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="hub-btn"
                  onClick={() =>
                    onChange({ sharedWithUsers: [...new Set([...selected, ...candidates])] })
                  }
                >
                  {t('server.selectAllShareUsers')}
                </button>
                <button
                  type="button"
                  className="hub-btn"
                  onClick={() =>
                    onChange({
                      sharedWithUsers: selected.filter((name) => !candidates.includes(name)),
                    })
                  }
                >
                  {t('server.deselectAllShareUsers')}
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-56 overflow-y-auto">
                {candidates.map((username) => (
                  <label key={username} className="flex gap-2 text-sm break-all">
                    <input
                      type="checkbox"
                      checked={selected.includes(username)}
                      onChange={(event) =>
                        onChange({
                          sharedWithUsers: event.target.checked
                            ? [...selected, username]
                            : selected.filter((name) => name !== username),
                        })
                      }
                    />
                    {username}
                  </label>
                ))}
              </div>
              {!loading && !error && candidates.length === 0 && (
                <p>{t('server.noMatchingShareUsers')}</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
