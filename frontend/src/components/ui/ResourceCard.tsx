import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, ChevronRight, Edit } from '@/components/icons/LucideIcons';
import { Resource } from '@/types';
import { Switch } from './ToggleGroup';

interface ResourceCardProps {
  resource: Resource;
  onToggle?: (resourceUri: string, enabled: boolean) => void;
  onDescriptionUpdate?: (resourceUri: string, description: string) => Promise<void> | void;
}

const ResourceCard = ({ resource, onToggle, onDescriptionUpdate }: ResourceCardProps) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [customDescription, setCustomDescription] = useState(resource.description || '');
  const descriptionInputRef = useRef<HTMLInputElement>(null);
  const descriptionTextRef = useRef<HTMLSpanElement>(null);
  const [textWidth, setTextWidth] = useState<number>(0);

  useEffect(() => {
    if (isEditingDescription && descriptionInputRef.current) {
      descriptionInputRef.current.focus();
      if (textWidth > 0) {
        descriptionInputRef.current.style.width = `${textWidth + 20}px`;
      }
    }
  }, [isEditingDescription, textWidth]);

  useEffect(() => {
    if (!isEditingDescription && descriptionTextRef.current) {
      setTextWidth(descriptionTextRef.current.offsetWidth);
    }
  }, [isEditingDescription, customDescription]);

  useEffect(() => {
    setCustomDescription(resource.description || '');
  }, [resource.description]);

  const handleToggle = (enabled: boolean) => {
    if (onToggle) {
      onToggle(resource.uri, enabled);
    }
  };

  const handleDescriptionSave = async () => {
    setIsEditingDescription(false);
    if (onDescriptionUpdate) {
      await onDescriptionUpdate(resource.uri, customDescription);
    }
  };

  const handleDescriptionKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleDescriptionSave();
    } else if (e.key === 'Escape') {
      setCustomDescription(resource.description || '');
      setIsEditingDescription(false);
    }
  };

  return (
    <div className="bg-white border border-gray-200 shadow rounded-lg mb-4">
      <div
        className="flex justify-between items-center p-2 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-medium text-gray-900 truncate">
            {resource.name || resource.uri}
          </h3>
          <div className="text-sm text-gray-500 truncate">{resource.uri}</div>
          <span className="text-sm font-normal text-gray-500 inline-flex items-center mt-1">
            {isEditingDescription ? (
              <>
                <input
                  ref={descriptionInputRef}
                  type="text"
                  className="px-2 py-1 border border-blue-300 rounded bg-white text-sm focus:outline-none form-input"
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  onKeyDown={handleDescriptionKeyDown}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    minWidth: '100px',
                    width: textWidth > 0 ? `${textWidth + 20}px` : 'auto',
                  }}
                />
                <button
                  className="ml-2 p-1 text-green-600 hover:text-green-800 cursor-pointer transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDescriptionSave();
                  }}
                >
                  <Check size={16} />
                </button>
              </>
            ) : (
              <>
                <span ref={descriptionTextRef}>{customDescription || t('tool.noDescription')}</span>
                <button
                  className="ml-2 p-1 text-gray-500 hover:text-blue-600 cursor-pointer transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsEditingDescription(true);
                  }}
                >
                  <Edit size={14} />
                </button>
              </>
            )}
          </span>
        </div>

        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-2" onClick={(e) => e.stopPropagation()}>
            <Switch checked={resource.enabled !== false} onCheckedChange={handleToggle} />
          </div>
          <button className="text-gray-400 hover:text-gray-600">
            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-2 px-3 pb-3 text-sm text-gray-600 border-t border-gray-100">
          <div className="pt-2">
            <span className="font-medium">{t('builtinResources.mimeType')}:</span>{' '}
            {resource.mimeType || 'text/plain'}
          </div>
        </div>
      )}
    </div>
  );
};

export default ResourceCard;
