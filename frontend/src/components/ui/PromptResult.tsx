import React from 'react';
import { useTranslation } from 'react-i18next';
import { CheckCircle, XCircle, AlertCircle } from '@/components/icons/LucideIcons';

interface PromptResultProps {
  result: {
    success: boolean;
    data?: any;
    error?: string;
    message?: string;
  };
  onClose: () => void;
}

const PromptResult: React.FC<PromptResultProps> = ({ result, onClose }) => {
  const { t } = useTranslation();

  const renderContent = (content: any): React.ReactNode => {
    if (typeof content === 'string') {
      return (
        <div className="bg-gray-50 rounded-md p-3">
          <pre className="whitespace-pre-wrap text-sm text-gray-800 font-mono">{content}</pre>
        </div>
      );
    }

    if (typeof content === 'object' && content !== null) {
      // Handle the specific prompt data structure
      if (content.description || content.messages) {
        return (
          <div className="space-y-4">
            {content.description && (
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2">{t('prompt.description')}</h4>
                <div className="bg-gray-50 rounded-md p-3">
                  <p className="text-sm text-gray-800">{content.description}</p>
                </div>
              </div>
            )}
            
            {content.messages && (
              <div>
                <h4 className="text-sm font-medium text-gray-900 mb-2">{t('prompt.messages')}</h4>
                <div className="space-y-3">
                  {content.messages.map((message: any, index: number) => (
                    <div key={index} className="bg-gray-50 rounded-md p-3">
                      <div className="flex items-center mb-2">
                        <span className="inline-block w-16 text-xs font-medium text-gray-500">
                          {message.role}:
                        </span>
                      </div>
                      {typeof message.content === 'string' ? (
                        <pre className="whitespace-pre-wrap text-sm text-gray-800 font-mono">
                          {message.content}
                        </pre>
                      ) : typeof message.content === 'object' && message.content.type === 'text' ? (
                        <pre className="whitespace-pre-wrap text-sm text-gray-800 font-mono">
                          {message.content.text}
                        </pre>
                      ) : (
                        <pre className="text-sm text-gray-800 overflow-auto">
                          {JSON.stringify(message.content, null, 2)}
                        </pre>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      }

      // For other structured content, try to parse as JSON
      try {
        const parsed = typeof content === 'string' ? JSON.parse(content) : content;

        return (
          <div className="bg-gray-50 rounded-md p-3">
            <div className="text-xs text-gray-500 mb-2">{t('prompt.jsonResponse')}</div>
            <pre className="text-sm text-gray-800 overflow-auto">{JSON.stringify(parsed, null, 2)}</pre>
          </div>
        );
      } catch {
        // If not valid JSON, show as string
        return (
          <div className="bg-gray-50 rounded-md p-3">
            <pre className="whitespace-pre-wrap text-sm text-gray-800 font-mono">{String(content)}</pre>
          </div>
        );
      }
    }

    return (
      <div className="bg-gray-50 rounded-md p-3">
        <pre className="whitespace-pre-wrap text-sm text-gray-800 font-mono">{String(content)}</pre>
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
                {t('prompt.execution')} {result.success ? t('prompt.successful') : t('prompt.failed')}
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
            {result.data ? (
              <div>
                <div className="text-sm text-gray-600 mb-3">{t('prompt.result')}</div>
                {renderContent(result.data)}
              </div>
            ) : (
              <div className="text-sm text-gray-500 italic">
                {t('prompt.noContent')}
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="flex items-center space-x-2 mb-3">
              <AlertCircle size={16} className="text-red-500" />
              <span className="text-sm font-medium text-red-700">{t('prompt.error')}</span>
            </div>
            <div className="bg-red-50 border border-red-300 rounded-md p-3">
              <pre className="text-sm text-red-800 whitespace-pre-wrap">
                {result.error || result.message || t('prompt.unknownError')}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PromptResult;