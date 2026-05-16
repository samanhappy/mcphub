import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, ChevronRight, Edit } from '@/components/icons/LucideIcons';
import { Resource } from '@/types';
import { Switch } from './ToggleGroup';
import ResetDescriptionButton from './ResetDescriptionButton';

interface ResourceCardProps {
  resource: Resource;
  onToggle?: (resourceUri: string, enabled: boolean) => void;
  onDescriptionUpdate?: (
    resourceUri: string,
    description: string,
    options?: { restored?: boolean },
  ) => Promise<void> | void;
}

const ResourceCard = ({ resource, onToggle, onDescriptionUpdate }: ResourceCardProps) => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [isResettingDescription, setIsResettingDescription] = useState(false);
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

  const handleDescriptionReset = async () => {
    setIsResettingDescription(true);
    try {
      await onDescriptionUpdate?.(resource.uri, '', { restored: true });
      setIsEditingDescription(false);
    } finally {
      setIsResettingDescription(false);
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
    <div
      className="hub-card overflow-hidden"
      style={{ marginBottom: 8 }}
    >
      <div
        className="flex justify-between items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-[var(--hub-surface-hover)] transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="hub-mono font-medium truncate" style={{ fontSize: 13, color: 'var(--hub-ink)' }}>
              {resource.name || resource.uri}
            </span>
            <span className="hub-mono truncate" style={{ fontSize: 11.5, color: 'var(--hub-ink-3)' }}>
              {resource.uri}
            </span>
          </div>
          <span className="flex items-center gap-1 mt-0.5" style={{ fontSize: 12, color: 'var(--hub-ink-3)' }}>
            {isEditingDescription ? (
              <>
                <input
                  ref={descriptionInputRef}
                  type="text"
                  className="hub-input"
                  style={{ height: 26, fontSize: 12, width: textWidth > 0 ? `${textWidth + 20}px` : 160, minWidth: 80 }}
                  value={customDescription}
                  onChange={(e) => setCustomDescription(e.target.value)}
                  onKeyDown={handleDescriptionKeyDown}
                  onClick={(e) => e.stopPropagation()}
                />
                <button
                  className="hub-icon-btn sm"
                  onClick={(e) => { e.stopPropagation(); handleDescriptionSave(); }}
                  disabled={isResettingDescription}
                >
                  <Check size={12} style={{ color: 'var(--hub-ok)' }} />
                </button>
                <ResetDescriptionButton
                  title={t('builtinResources.restoreDefault')}
                  onClick={(e) => { e.stopPropagation(); handleDescriptionReset(); }}
                  disabled={isResettingDescription}
                  loading={isResettingDescription}
                />
              </>
            ) : (
              <>
                <span ref={descriptionTextRef}>{customDescription || t('tool.noDescription')}</span>
                <button
                  className="hub-icon-btn sm"
                  onClick={(e) => { e.stopPropagation(); setIsEditingDescription(true); }}
                >
                  <Edit size={12} />
                </button>
                <ResetDescriptionButton
                  title={t('builtinResources.restoreDefault')}
                  onClick={(e) => { e.stopPropagation(); handleDescriptionReset(); }}
                  disabled={isResettingDescription}
                  loading={isResettingDescription}
                />
              </>
            )}
          </span>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div onClick={(e) => e.stopPropagation()}>
            <Switch checked={resource.enabled !== false} onCheckedChange={handleToggle} />
          </div>
          <button className="hub-icon-btn sm">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div style={{ borderTop: '1px solid var(--hub-line-2)', padding: '8px 12px' }}>
          <span className="hub-sect">{t('builtinResources.mimeType')}:</span>{' '}
          <span style={{ fontSize: 12, color: 'var(--hub-ink-2)' }}>{resource.mimeType || 'text/plain'}</span>
        </div>
      )}
    </div>
  );
};

export default ResourceCard;
