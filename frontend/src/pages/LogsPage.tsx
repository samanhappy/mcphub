// filepath: /Users/sunmeng/code/github/mcphub/frontend/src/pages/LogsPage.tsx
import React from 'react';
import { useTranslation } from 'react-i18next';
import LogViewer from '../components/LogViewer';
import { useLogs } from '../services/logService';

const LogsPage: React.FC = () => {
  const { t } = useTranslation();
  const { logs, loading, error, clearLogs } = useLogs();

  return (
    <div className="container mx-auto p-4">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-bold text-gray-900">{t('pages.logs.title')}</h1>
      </div>
      <div className="bg-card rounded-md shadow-sm border border-gray-200 page-card">
        <LogViewer
          logs={logs}
          isLoading={loading}
          error={error}
          onClear={clearLogs}
        />
      </div>
    </div>
  );
};

export default LogsPage;