import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, XCircle, AlertCircle } from '@/components/icons/LucideIcons';

interface ToolResultProps {
  result: {
    success: boolean;
    content?: Array<{
      type: string;
      text?: string;
      [key: string]: any;
    }>;
    error?: string;
    message?: string;
  };
  onClose: () => void;
}

const ToolResult: React.FC<ToolResultProps> = ({ result, onClose }) => {
  const { t } = useTranslation();
  // Extract content from data.content
  const content = result.content;

  const renderContent = (content: any): React.ReactNode => {
    if (Array.isArray(content)) {
      return content.map((item, index) => (
        <div key={index} className="mb-3 last:mb-0">
          {renderContentItem(item)}
        </div>
      ));
    }

    return renderContentItem(content);
  };

  const renderContentItem = (item: any): React.ReactNode => {
    if (typeof item === 'string') {
      return (
        <div className="bg-gray-50 rounded-md p-3">
          <pre className="whitespace-pre-wrap text-sm text-gray-800 font-mono">{item}</pre>
        </div>
      );
    }

    if (typeof item === 'object' && item !== null) {
      if (item.type === 'text' && item.text) {
        return (
          <div className="bg-gray-50 rounded-md p-3">
            <pre className="whitespace-pre-wrap text-sm text-gray-800 font-mono">{item.text}</pre>
          </div>
        );
      }

      if (item.type === 'image' && item.data) {
        return (
          <div className="bg-gray-50 rounded-md p-3">
            <img
              src={`data:${item.mimeType || 'image/png'};base64,${item.data}`}
              alt={t('tool.toolResult')}
              className="max-w-full h-auto rounded-md"
            />
          </div>
        );
      }

      // For other structured content, try to parse as JSON
      try {
        const parsed = typeof item === 'string' ? JSON.parse(item) : item;

        return (
          <div className="bg-gray-50 rounded-md p-3">
            <div className="text-xs text-gray-500 mb-2">{t('tool.jsonResponse')}</div>
            <pre className="text-sm text-gray-800 overflow-auto">{JSON.stringify(parsed, null, 2)}</pre>
          </div>
        );
      } catch {
        // If not valid JSON, show as string
        return (
          <div className="bg-gray-50 rounded-md p-3">
            <pre className="whitespace-pre-wrap text-sm text-gray-800 font-mono">{String(item)}</pre>
          </div>
        );
      }
    }

    return (
      <div className="bg-gray-50 rounded-md p-3">
        <pre className="whitespace-pre-wrap text-sm text-gray-800 font-mono">{String(item)}</pre>
      </div>
    );
  };

  return (
    <div className="border border-gray-300 rounded-lg bg-white shadow-sm">
      <div className="border-b border-gray-300 px-4 py-3 bg-gray-50 rounded-t-lg">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {result.success ? (
              <CheckCircle size={20} className="text-status-green" />
            ) : (
              <XCircle size={20} className="text-status-red" />
            )}
            <div>
              <h4 className="text-sm font-medium text-gray-900">
                {t('tool.execution')} {result.success ? t('tool.successful') : t('tool.failed')}
              </h4>

            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-sm"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="p-4">
        {result.success ? (
          <div>
            {result.content && result.content.length > 0 ? (
              <div>
                <div className="text-sm text-gray-600 mb-3">{t('tool.result')}</div>
                {renderContent(result.content)}
              </div>
            ) : (
              <div className="text-sm text-gray-500 italic">
                {t('tool.noContent')}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="flex items-center space-x-2 mb-3">
              <AlertCircle size={16} className="text-red-500" />
              <span className="text-sm font-medium text-red-700">{t('tool.error')}</span>
            </div>
            {content && content.length > 0 ? (
              <div>
                <div className="text-sm text-gray-600 mb-3">{t('tool.errorDetails')}</div>
                {renderContent(content)}
              </div>
            ) : (
              <div className="bg-red-50 border border-red-300 rounded-md p-3">
                <pre className="text-sm text-red-800 whitespace-pre-wrap">
                  {result.error || result.message || t('tool.unknownError')}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ToolResult;
