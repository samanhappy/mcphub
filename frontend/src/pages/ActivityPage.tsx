import React, { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  ActivityStats,
  ActivityFilter,
  ActivityFilterOptions,
  ActivityStatus,
} from '@/types';
import {
  getActivities,
  getActivityById,
  getActivityStats,
  getActivityFilterOptions,
  deleteOldActivities,
} from '@/services/activityService';
import Pagination from '@/components/ui/Pagination';

// Pagination info type
interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

const STATUS_OPTIONS: ActivityStatus[] = ['success', 'error'];

const isValidStatus = (value: string): value is ActivityStatus =>
  STATUS_OPTIONS.includes(value as ActivityStatus);

const ActivityPage: React.FC = () => {
  const { t } = useTranslation();

  // State
  const [activities, setActivities] = useState<Activity[]>([]);
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [filterOptions, setFilterOptions] = useState<ActivityFilterOptions | null>(null);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedActivity, setSelectedActivity] = useState<Activity | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // Filter state
  const [appliedFilters, setAppliedFilters] = useState<ActivityFilter>({});
  const [searchServer, setSearchServer] = useState('');
  const [searchTool, setSearchTool] = useState('');
  const [searchStatus, setSearchStatus] = useState<string>('');
  const [searchGroup, setSearchGroup] = useState('');
  const [searchUsername, setSearchUsername] = useState('');
  const [searchKeyName, setSearchKeyName] = useState('');

  // Fetch data
  const fetchData = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Use appliedFilters directly for fetching
      const currentFilter = { ...appliedFilters };

      // Fetch activities, stats, and filter options in parallel
      const [activitiesRes, statsRes, optionsRes] = await Promise.all([
        getActivities(currentPage, itemsPerPage, currentFilter),
        getActivityStats(currentFilter),
        getActivityFilterOptions(),
      ]);

      if (activitiesRes?.success && Array.isArray(activitiesRes.data)) {
        setActivities(activitiesRes.data);
        if (activitiesRes.pagination) {
          setPagination(activitiesRes.pagination);
        }
      }

      if (statsRes?.success && statsRes.data) {
        setStats(statsRes.data);
      }

      if (optionsRes?.success && optionsRes.data) {
        setFilterOptions(optionsRes.data);
      }
    } catch (err) {
      console.error('Error fetching activity data:', err);
      setError(t('activity.fetchError'));
    } finally {
      setIsLoading(false);
    }
  }, [currentPage, itemsPerPage, appliedFilters, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!pagination) {
      return;
    }

    const totalPages = Math.max(1, pagination.totalPages || 1);
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [pagination, currentPage]);

  // Handle view activity details
  const handleViewDetails = async (activity: Activity) => {
    try {
      const response = await getActivityById(activity.id);
      if (response?.success && response.data) {
        setSelectedActivity(response.data);
        setShowDetailModal(true);
      }
    } catch (err) {
      console.error('Error fetching activity details:', err);
    }
  };

  // Handle cleanup old activities
  const handleCleanup = async () => {
    if (!window.confirm(t('activity.confirmCleanup'))) {
      return;
    }

    try {
      const response = await deleteOldActivities(30);
      if (response?.success) {
        alert(t('activity.cleanupSuccess', { count: response.data?.deletedCount || 0 }));
        fetchData();
      }
    } catch (err) {
      console.error('Error cleaning up activities:', err);
      alert(t('activity.cleanupError'));
    }
  };

  // Handle search
  const handleSearch = () => {
    const filters: ActivityFilter = {};
    if (searchServer) filters.server = searchServer;
    if (searchTool) filters.tool = searchTool;
    if (searchStatus && isValidStatus(searchStatus)) {
      filters.status = searchStatus;
    }
    if (searchGroup) filters.group = searchGroup;
    if (searchUsername) filters.username = searchUsername;
    if (searchKeyName) filters.keyName = searchKeyName;

    setAppliedFilters(filters);
    setCurrentPage(1);
  };

  // Handle clear filters
  const handleClearFilters = () => {
    setSearchServer('');
    setSearchTool('');
    setSearchStatus('');
    setSearchGroup('');
    setSearchUsername('');
    setSearchKeyName('');
    setAppliedFilters({});
    setCurrentPage(1);
  };

  // Format duration
  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
    return `${(ms / 60000).toFixed(2)}m`;
  };

  // Format timestamp
  const formatTimestamp = (timestamp: string): string => {
    return new Date(timestamp).toLocaleString();
  };

  // Parse JSON safely
  const safeParseJSON = (str: string | undefined): any => {
    if (!str) return null;
    try {
      return JSON.parse(str);
    } catch {
      return str;
    }
  };

  // Render stats cards
  const renderStats = () => {
    if (!stats) return null;

    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {[
          { label: t('activity.totalCalls'), value: stats.totalCalls, tone: 'default' as const },
          { label: t('activity.successCount'), value: stats.successCount, tone: 'ok' as const },
          { label: t('activity.errorCount'), value: stats.errorCount, tone: 'err' as const },
          {
            label: t('activity.avgDuration'),
            value: formatDuration(stats.avgDuration),
            tone: 'default' as const,
          },
        ].map((s) => (
          <div key={s.label} className="hub-card" style={{ padding: '12px 14px' }}>
            <div className="text-[12px]" style={{ color: 'var(--hub-ink-3)' }}>
              {s.label}
            </div>
            <div
              className="hub-num"
              style={{
                fontSize: 22,
                fontWeight: 500,
                lineHeight: 1.1,
                marginTop: 6,
                letterSpacing: '-0.02em',
                color:
                  s.tone === 'ok'
                    ? 'oklch(0.4 0.13 145)'
                    : s.tone === 'err'
                      ? 'oklch(0.45 0.18 25)'
                      : 'var(--hub-ink)',
              }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Render filters
  const renderFilters = () => {
    return (
      <div className="hub-card px-4 py-3 mb-4">
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[140px]">
            <label className="sr-only" htmlFor="activity-server">
              {t('activity.server')}
            </label>
            <div className="relative">
              <input
                id="activity-server"
                type="text"
                value={searchServer}
                onChange={(e) => setSearchServer(e.target.value)}
                placeholder={t('activity.searchServer')}
                className="hub-input pr-9"
                list="server-options"
              />
              {searchServer && (
                <button
                  onClick={() => setSearchServer('')}
                  className="absolute inset-y-0 right-2 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label={t('common.clear')}
                  type="button"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              )}
            </div>
            {filterOptions?.servers && (
              <datalist id="server-options">
                {filterOptions.servers.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            )}
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="sr-only" htmlFor="activity-tool">
              {t('activity.tool')}
            </label>
            <div className="relative">
              <input
                id="activity-tool"
                type="text"
                value={searchTool}
                onChange={(e) => setSearchTool(e.target.value)}
                placeholder={t('activity.searchTool')}
                className="hub-input pr-9"
                list="tool-options"
              />
              {searchTool && (
                <button
                  onClick={() => setSearchTool('')}
                  className="absolute inset-y-0 right-2 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label={t('common.clear')}
                  type="button"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              )}
            </div>
            {filterOptions?.tools && (
              <datalist id="tool-options">
                {filterOptions.tools.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            )}
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="sr-only" htmlFor="activity-status">
              {t('activity.status')}
            </label>
            <div className="relative">
              <input
                id="activity-status"
                type="text"
                value={searchStatus}
                onChange={(e) => setSearchStatus(e.target.value.toLowerCase())}
                placeholder={t('activity.searchStatus')}
                className="hub-input pr-9"
                list="activity-status-options"
              />
              {searchStatus && (
                <button
                  onClick={() => setSearchStatus('')}
                  className="absolute inset-y-0 right-2 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label={t('common.clear')}
                  type="button"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              )}
            </div>
            <datalist id="activity-status-options">
              {STATUS_OPTIONS.map((status) => (
                <option key={status} value={status} />
              ))}
            </datalist>
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="sr-only" htmlFor="activity-group">
              {t('activity.group')}
            </label>
            <div className="relative">
              <input
                id="activity-group"
                type="text"
                value={searchGroup}
                onChange={(e) => setSearchGroup(e.target.value)}
                placeholder={t('activity.searchGroup')}
                className="hub-input pr-9"
                list="group-options"
              />
              {searchGroup && (
                <button
                  onClick={() => setSearchGroup('')}
                  className="absolute inset-y-0 right-2 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label={t('common.clear')}
                  type="button"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              )}
            </div>
            {filterOptions?.groups && (
              <datalist id="group-options">
                {filterOptions.groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            )}
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="sr-only" htmlFor="activity-username">
              {t('activity.user')}
            </label>
            <div className="relative">
              <input
                id="activity-username"
                type="text"
                value={searchUsername}
                onChange={(e) => setSearchUsername(e.target.value)}
                placeholder={t('activity.searchUsername')}
                className="hub-input pr-9"
                list="username-options"
              />
              {searchUsername && (
                <button
                  onClick={() => setSearchUsername('')}
                  className="absolute inset-y-0 right-2 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label={t('common.clear')}
                  type="button"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              )}
            </div>
            {filterOptions?.usernames && (
              <datalist id="username-options">
                {filterOptions.usernames.map((username) => (
                  <option key={username} value={username} />
                ))}
              </datalist>
            )}
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="sr-only" htmlFor="activity-keyname">
              {t('activity.keyName')}
            </label>
            <div className="relative">
              <input
                id="activity-keyname"
                type="text"
                value={searchKeyName}
                onChange={(e) => setSearchKeyName(e.target.value)}
                placeholder={t('activity.searchKeyName')}
                className="hub-input pr-9"
                list="keyname-options"
              />
              {searchKeyName && (
                <button
                  onClick={() => setSearchKeyName('')}
                  className="absolute inset-y-0 right-2 flex items-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label={t('common.clear')}
                  type="button"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>
              )}
            </div>
            {filterOptions?.keyNames && (
              <datalist id="keyname-options">
                {filterOptions.keyNames.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            )}
          </div>
          <div className="flex-shrink-0 flex items-center gap-2">
            <button onClick={handleSearch} className="hub-btn primary whitespace-nowrap">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-3.5 w-3.5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z"
                  clipRule="evenodd"
                />
              </svg>
              {t('common.search')}
            </button>
            <button onClick={handleClearFilters} className="hub-btn whitespace-nowrap">
              {t('common.clear')}
            </button>
          </div>
        </div>
      </div>
    );
  };

  // Render activity table
  const renderActivityTable = () => {
    if (activities.length === 0) {
      return (
        <div className="hub-card p-10 text-center" style={{ color: 'var(--hub-ink-3)' }}>
          {t('activity.noData')}
        </div>
      );
    }

    return (
      <div className="hub-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead style={{ background: 'var(--hub-bg-2)' }}>
              <tr>
                {[
                  t('activity.timestamp'),
                  t('activity.server'),
                  t('activity.tool'),
                  t('activity.duration'),
                  t('activity.status'),
                  t('activity.group'),
                  t('activity.user'),
                  t('activity.key'),
                  t('activity.sourceIp'),
                  t('common.actions'),
                ].map((label) => (
                  <th
                    key={label}
                    className="hub-mono"
                    style={{
                      padding: '9px 14px',
                      textAlign: 'left',
                      fontSize: 11,
                      color: 'var(--hub-ink-3)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      fontWeight: 500,
                    }}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {activities.map((activity) => (
                <tr
                  key={activity.id}
                  className="transition-colors hover:bg-[var(--hub-surface-hover)]"
                  style={{ borderTop: '1px solid var(--hub-line-2)' }}
                >
                  <td
                    className="hub-mono whitespace-nowrap"
                    style={{ padding: '10px 14px', fontSize: 12, color: 'var(--hub-ink-2)' }}
                  >
                    {formatTimestamp(activity.timestamp)}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span className="hub-tag">{activity.server}</span>
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <span className="hub-tag accent">{activity.tool}</span>
                  </td>
                  <td
                    className="hub-mono hub-num whitespace-nowrap"
                    style={{ padding: '10px 14px', fontSize: 12, color: 'var(--hub-ink-2)' }}
                  >
                    {formatDuration(activity.duration)}
                  </td>
                  <td style={{ padding: '10px 14px' }} className="whitespace-nowrap">
                    <span
                      className={`hub-status ${activity.status === 'success' ? 'ok' : 'err'}`}
                    >
                      <span className="hub-dot" />
                      {activity.status === 'success'
                        ? t('activity.statusSuccess')
                        : t('activity.statusError')}
                    </span>
                  </td>
                  <td
                    style={{ padding: '10px 14px', fontSize: 12, color: 'var(--hub-ink-3)' }}
                  >
                    {activity.group || '—'}
                  </td>
                  <td
                    style={{ padding: '10px 14px', fontSize: 12, color: 'var(--hub-ink-3)' }}
                  >
                    {activity.username || '—'}
                  </td>
                  <td
                    style={{ padding: '10px 14px', fontSize: 12, color: 'var(--hub-ink-3)' }}
                  >
                    {activity.keyName || '—'}
                  </td>
                  <td
                    className="hub-mono whitespace-nowrap"
                    style={{ padding: '10px 14px', fontSize: 12, color: 'var(--hub-ink-3)' }}
                  >
                    {activity.sourceIp || '—'}
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <button
                      onClick={() => handleViewDetails(activity)}
                      className="hub-btn ghost sm"
                      style={{ color: 'var(--hub-accent)' }}
                    >
                      {t('common.view')}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // Render detail modal
  const renderDetailModal = () => {
    if (!showDetailModal || !selectedActivity) return null;

    const inputData = safeParseJSON(selectedActivity.input);
    const outputData = safeParseJSON(selectedActivity.output);

    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
        <div
          className="hub-card max-w-4xl w-full mx-4 max-h-[90vh] overflow-hidden"
          style={{ boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }}
        >
          <div
            className="flex items-center justify-between px-5 py-3"
            style={{ borderBottom: '1px solid var(--hub-line-2)' }}
          >
            <h3 className="hub-card-title">{t('activity.details')}</h3>
            <button
              onClick={() => setShowDetailModal(false)}
              className="hub-icon-btn sm"
              aria-label="close"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>
          <div className="px-6 py-4 overflow-y-auto max-h-[calc(90vh-120px)]">
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t('activity.timestamp')}
                </label>
                <p className="text-gray-900 dark:text-white">
                  {formatTimestamp(selectedActivity.timestamp)}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t('activity.duration')}
                </label>
                <p className="text-gray-900 dark:text-white">
                  {formatDuration(selectedActivity.duration)}
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t('activity.server')}
                </label>
                <p className="text-gray-900 dark:text-white font-mono">{selectedActivity.server}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t('activity.tool')}
                </label>
                <p className="text-gray-900 dark:text-white font-mono">{selectedActivity.tool}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t('activity.status')}
                </label>
                <span
                  className={`px-2 py-1 rounded text-xs font-medium ${
                    selectedActivity.status === 'success'
                      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                      : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                  }`}
                >
                  {selectedActivity.status === 'success'
                    ? t('activity.statusSuccess')
                    : t('activity.statusError')}
                </span>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t('activity.group')}
                </label>
                <p className="text-gray-900 dark:text-white">{selectedActivity.group || '-'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t('activity.user')}
                </label>
                <p className="text-gray-900 dark:text-white">{selectedActivity.username || '-'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400">
                  {t('activity.sourceIp')}
                </label>
                <p className="text-gray-900 dark:text-white font-mono">
                  {selectedActivity.sourceIp || '-'}
                </p>
              </div>
              {selectedActivity.keyName && (
                <div>
                  <label className="block text-sm font-medium text-gray-500 dark:text-gray-400">
                    {t('activity.key')}
                  </label>
                  <p className="text-gray-900 dark:text-white">{selectedActivity.keyName}</p>
                </div>
              )}
            </div>

            {selectedActivity.errorMessage && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-red-500 mb-1">
                  {t('activity.errorMessage')}
                </label>
                <div className="bg-red-50 dark:bg-red-900/20 rounded p-3 text-sm text-red-800 dark:text-red-200">
                  {selectedActivity.errorMessage}
                </div>
              </div>
            )}

            {inputData && (
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                  {t('activity.input')}
                </label>
                <pre className="bg-gray-100 dark:bg-gray-700 rounded p-3 text-sm overflow-x-auto max-h-64">
                  {typeof inputData === 'string' ? inputData : JSON.stringify(inputData, null, 2)}
                </pre>
              </div>
            )}

            {outputData && (
              <div>
                <label className="block text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">
                  {t('activity.output')}
                </label>
                <pre className="bg-gray-100 dark:bg-gray-700 rounded p-3 text-sm overflow-x-auto max-h-64">
                  {typeof outputData === 'string'
                    ? outputData
                    : JSON.stringify(outputData, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-end justify-between gap-4 mb-6">
        <div>
          <h1 className="hub-h1">{t('activity.title')}</h1>
          <p className="hub-sub">
            <span className="hub-num">{pagination?.total ?? activities.length}</span> entries
          </p>
        </div>
        <button onClick={handleCleanup} className="hub-btn danger">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3.5 w-3.5"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
              clipRule="evenodd"
            />
          </svg>
          {t('activity.cleanup')}
        </button>
      </div>

      {error && (
        <div
          className="hub-card flex items-center justify-between gap-3 mb-4"
          style={{
            padding: '10px 14px',
            borderColor: 'oklch(0.85 0.1 25)',
            background: 'oklch(0.97 0.03 25)',
            color: 'oklch(0.4 0.18 25)',
          }}
        >
          <span className="truncate text-[13px]">{error}</span>
          <button className="hub-icon-btn sm" onClick={() => setError(null)} aria-label="close">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3 w-3"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      )}

      {isLoading && activities.length === 0 ? (
        <div className="hub-card p-10 text-center" style={{ color: 'var(--hub-ink-3)' }}>
          {t('app.loading')}
        </div>
      ) : (
        <>
          {renderStats()}
          {renderFilters()}
          {renderActivityTable()}

          {/* Pagination */}
          <div className="flex items-center mt-6">
            <div className="flex-[2] text-sm text-gray-500 dark:text-gray-400">
              {pagination &&
                t('common.showing', {
                  start: (pagination.page - 1) * pagination.limit + 1,
                  end: Math.min(pagination.page * pagination.limit, pagination.total),
                  total: pagination.total,
                })}
            </div>
            <div className="flex-[4] flex justify-center">
              {pagination && pagination.totalPages > 1 && (
                <Pagination
                  currentPage={currentPage}
                  totalPages={pagination.totalPages}
                  onPageChange={setCurrentPage}
                  disabled={isLoading}
                />
              )}
            </div>
            <div className="flex-[2] flex items-center justify-end space-x-2">
              <label htmlFor="perPage" className="text-sm text-gray-500 dark:text-gray-400">
                {t('common.itemsPerPage')}:
              </label>
              <select
                id="perPage"
                value={itemsPerPage}
                onChange={(e) => {
                  setItemsPerPage(Number(e.target.value));
                  setCurrentPage(1);
                }}
                disabled={isLoading}
                className="border border-gray-300 dark:border-gray-600 rounded p-1 text-sm dark:bg-gray-700 dark:text-white outline-none disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </div>
          </div>
        </>
      )}

      {renderDetailModal()}
    </div>
  );
};

export default ActivityPage;
