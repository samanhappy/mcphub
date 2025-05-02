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
        <h1 className="text-2xl font-bold">{t('pages.logs.title')}</h1>
      </div>
      <div className="bg-card rounded-md shadow-sm">
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