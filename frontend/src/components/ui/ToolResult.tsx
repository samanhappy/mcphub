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

type ImagePayload = {
  data: string;
  mimeType?: string;
};

const ToolResult: React.FC<ToolResultProps> = ({ result, onClose }) => {
  const { t } = useTranslation();
  // Extract content from data.content
  const content = result.content;

  const normalizeMimeType = (value?: string) => {
    if (!value) return 'image/png';
    return value.startsWith('image/') ? value : `image/${value}`;
  };

  const collectImagesFromValue = (value: any): ImagePayload[] => {
    if (!value) return [];

    if (Array.isArray(value)) {
      return value.flatMap((item) => collectImagesFromValue(item));
    }

    if (typeof value !== 'object') return [];

    const images: ImagePayload[] = [];

    if (value.type === 'image' && value.data) {
      images.push({
        data: String(value.data),
        mimeType: normalizeMimeType(value.mimeType || value.mime_type),
      });
    }

    const base64 =
      value.image_base64 ||
      value.imageBase64 ||
      value.image_data ||
      value.imageData ||
      value.base64;
    if (base64) {
      images.push({
        data: String(base64),
        mimeType: normalizeMimeType(
          value.image_mimeType || value.image_mime_type || value.mimeType || value.mime_type,
        ),
      });
    }

    if (value.image && typeof value.image === 'object') {
      images.push(...collectImagesFromValue(value.image));
    }

    if (Array.isArray(value.images)) {
      images.push(...collectImagesFromValue(value.images));
    }

    if (Array.isArray(value.content)) {
      images.push(...collectImagesFromValue(value.content));
    }

    return images;
  };

  const extractImagesFromText = (text: string): ImagePayload[] => {
    const images: ImagePayload[] = [];

    try {
      const parsed = JSON.parse(text);
      images.push(...collectImagesFromValue(parsed));
      if (images.length > 0) {
        return images;
      }
    } catch {
      // Not JSON, continue to data URI scan
    }

    const dataUriRegex = /data:image\/(png|jpe?g|gif|webp);base64,([A-Za-z0-9+/=]+)/g;
    let match: RegExpExecArray | null;
    while ((match = dataUriRegex.exec(text)) !== null) {
      const mimeType = `image/${match[1] === 'jpg' ? 'jpeg' : match[1]}`;
      images.push({ data: match[2], mimeType });
    }

    return images;
  };

  const sanitizeTextForDisplay = (text: string): string => {
    try {
      const parsed = JSON.parse(text);
      const scrub = (value: any): any => {
        if (Array.isArray(value)) return value.map(scrub);
        if (value && typeof value === 'object') {
          const next: Record<string, any> = {};
          for (const [key, val] of Object.entries(value)) {
            if (typeof val === 'string' && key.toLowerCase().includes('base64')) {
              next[key] = '[base64 omitted]';
            } else {
              next[key] = scrub(val);
            }
          }
          return next;
        }
        return value;
      };
      return JSON.stringify(scrub(parsed), null, 2);
    } catch {
      return text.replace(
        /data:image\/(png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+/g,
        '[image data omitted]',
      );
    }
  };

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
      const extractedImages = extractImagesFromText(item);
      const sanitizedText = sanitizeTextForDisplay(item);
      return (
        <div className="bg-gray-50 rounded-md p-3">
          {extractedImages.length > 0 && (
            <div className="mb-3 space-y-3">
              {extractedImages.map((image, idx) => (
                <img
                  key={idx}
                  src={`data:${image.mimeType || 'image/png'};base64,${image.data}`}
                  alt={t('tool.toolResult')}
                  className="max-w-full h-auto rounded-md"
                />
              ))}
            </div>
          )}
          <pre className="whitespace-pre-wrap text-sm text-gray-800 font-mono">
            {sanitizedText}
          </pre>
        </div>
      );
    }

    if (typeof item === 'object' && item !== null) {
      if (item.type === 'text' && item.text) {
        const extractedImages = extractImagesFromText(item.text);
        const sanitizedText = sanitizeTextForDisplay(item.text);
        return (
          <div className="bg-gray-50 rounded-md p-3">
            {extractedImages.length > 0 && (
              <div className="mb-3 space-y-3">
                {extractedImages.map((image, idx) => (
                  <img
                    key={idx}
                    src={`data:${image.mimeType || 'image/png'};base64,${image.data}`}
                    alt={t('tool.toolResult')}
                    className="max-w-full h-auto rounded-md"
                  />
                ))}
              </div>
            )}
            <pre className="whitespace-pre-wrap text-sm text-gray-800 font-mono">
              {sanitizedText}
            </pre>
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
