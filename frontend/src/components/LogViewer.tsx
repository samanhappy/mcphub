import React, { useEffect, useRef, useState } from 'react';
import { LogEntry } from '../services/logService';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { useTranslation } from 'react-i18next';

interface LogViewerProps {
  logs: LogEntry[];
  isLoading?: boolean;
  error?: Error | null;
  onClear?: () => void;
}

const LogViewer: React.FC<LogViewerProps> = ({ logs, isLoading = false, error = null, onClear }) => {
  const { t } = useTranslation();
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [filter, setFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<Array<'info' | 'error' | 'warn' | 'debug'>>(['info', 'error', 'warn', 'debug']);
  const [sourceFilter, setSourceFilter] = useState<Array<'main' | 'child'>>(['main', 'child']);

  // Auto scroll to bottom when new logs come in if autoScroll is enabled
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  // Filter logs based on current filter settings
  const filteredLogs = logs.filter(log => {
    const matchesText = filter ? log.message.toLowerCase().includes(filter.toLowerCase()) : true;
    const matchesType = typeFilter.includes(log.type);
    const matchesSource = sourceFilter.includes(log.source as 'main' | 'child');
    return matchesText && matchesType && matchesSource;
  });

  // Format timestamp to readable format
  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });
  };

  // Get badge color based on log type
  const getLogTypeColor = (type: string) => {
    switch (type) {
      case 'error': return 'bg-red-400/80 text-white';
      case 'warn': return 'bg-yellow-400/80 text-gray-900';
      case 'debug': return 'bg-purple-400/80 text-white';
      case 'info': return 'bg-blue-400/80 text-white';
      default: return 'bg-blue-400/80 text-white';
    }
  };

  // Get badge color based on log source
  const getSourceColor = (source: string) => {
    switch (source) {
      case 'main': return 'bg-green-400/80 text-white';
      case 'child': return 'bg-orange-400/80 text-white';
      default: return 'bg-gray-400/80 text-white';
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="bg-card p-3 rounded-t-md flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-semibold text-sm">{t('logs.filters')}:</span>

          {/* Text search filter */}
          <input
            type="text"
            placeholder={t('logs.search')}
            className="shadow appearance-none border border-gray-200 rounded py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline form-input"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />

          {/* Log type filters */}
          <div className="flex gap-1 items-center">
            {(['debug', 'info', 'error', 'warn'] as const).map(type => (
              <Badge
                key={type}
                variant={typeFilter.includes(type) ? 'default' : 'outline'}
                className={`cursor-pointer ${typeFilter.includes(type) ? getLogTypeColor(type) : ''}`}
                onClick={() => {
                  if (typeFilter.includes(type)) {
                    setTypeFilter(prev => prev.filter(t => t !== type));
                  } else {
                    setTypeFilter(prev => [...prev, type]);
                  }
                }}
              >
                {type}
              </Badge>
            ))}
          </div>

          {/* Log source filters */}
          <div className="flex gap-1 items-center ml-2">
            {(['main', 'child'] as const).map(source => (
              <Badge
                key={source}
                variant={sourceFilter.includes(source) ? 'default' : 'outline'}
                className={`cursor-pointer ${sourceFilter.includes(source) ? getSourceColor(source) : ''}`}
                onClick={() => {
                  if (sourceFilter.includes(source)) {
                    setSourceFilter(prev => prev.filter(s => s !== source));
                  } else {
                    setSourceFilter(prev => [...prev, source]);
                  }
                }}
              >
                {source === 'main' ? t('logs.mainProcess') : t('logs.childProcess')}
              </Badge>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={() => setAutoScroll(!autoScroll)}
              className="form-checkbox h-4 w-4"
            />
            {t('logs.autoScroll')}
          </label>
          <Button
            variant="outline"
            size="sm"
            onClick={onClear}
            className='btn-secondary'
            disabled={isLoading || logs.length === 0}
          >
            {t('logs.clearLogs')}
          </Button>
        </div>
      </div>

      <div
        ref={logContainerRef}
        className="flex-grow p-2 overflow-auto bg-card rounded-b-md font-mono text-sm"
        style={{ maxHeight: 'calc(100vh - 300px)' }}
      >
        {isLoading ? (
          <div className="flex justify-center items-center h-full">
            <span>{t('logs.loading')}</span>
          </div>
        ) : error ? (
          <div className="text-red-500 p-2">
            {error.message}
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="text-center text-muted-foreground p-8">
            {filter || typeFilter.length < 4 || sourceFilter.length < 2
              ? t('logs.noMatch')
              : t('logs.noLogs')}
          </div>
        ) : (
          filteredLogs.map((log, index) => (
            <div
              key={`${log.timestamp}-${index}`}
              className={`py-1 ${log.type === 'error' ? 'text-red-500' :
                log.type === 'warn' ? 'text-yellow-500' : ''
                }`}
            >
              <span className="text-gray-400">[{formatTimestamp(log.timestamp)}]</span>
              <Badge className={`ml-2 mr-1 ${getLogTypeColor(log.type)}`}>
                {log.type}
              </Badge>
              <Badge
                variant="default"
                className={`mr-2 ${getSourceColor(log.source)}`}
              >
                {log.source === 'main' ? t('logs.main') : t('logs.child')}
                {log.processId ? ` (${log.processId})` : ''}
              </Badge>
              <span className="whitespace-pre-wrap">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default LogViewer;