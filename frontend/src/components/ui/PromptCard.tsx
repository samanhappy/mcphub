import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Prompt } from '@/types';
import {
  ChevronDown,
  ChevronRight,
  Play,
  Loader,
  Edit,
  Check,
} from '@/components/icons/LucideIcons';
import { Switch } from './ToggleGroup';
import {
  getPrompt,
  updatePromptDescription,
  resetPromptDescription,
  PromptCallResult,
} from '@/services/promptService';
import { useSettingsData } from '@/hooks/useSettingsData';
import DynamicForm from './DynamicForm';
import PromptResult from './PromptResult';
import { useToast } from '@/contexts/ToastContext';
import ResetDescriptionButton from './ResetDescriptionButton';
import { formatTokens } from '@/utils/contextCost';

interface PromptCardProps {
  server: string;
  prompt: Prompt;
  readOnly?: boolean;
  onToggle?: (promptName: string, enabled: boolean) => void;
  onDescriptionUpdate?: (
    promptName: string,
    description: string,
    options?: { restored?: boolean },
  ) => void;
  cost?: number;
}

const PromptCard = ({ prompt, server, readOnly = false, onToggle, onDescriptionUpdate, cost }: PromptCardProps) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { nameSeparator } = useSettingsData();
  const [isExpanded, setIsExpanded] = useState(false);
  const [showRunForm, setShowRunForm] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<PromptCallResult | null>(null);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [isResettingDescription, setIsResettingDescription] = useState(false);
  const [customDescription, setCustomDescription] = useState(prompt.description || '');
  const descriptionInputRef = useRef<HTMLInputElement>(null);
  const descriptionTextRef = useRef<HTMLSpanElement>(null);
  const [textWidth, setTextWidth] = useState<number>(0);

  // Focus the input when editing mode is activated
  useEffect(() => {
    if (isEditingDescription && descriptionInputRef.current) {
      descriptionInputRef.current.focus();
      // Set input width to match text width
      if (textWidth > 0) {
        descriptionInputRef.current.style.width = `${textWidth + 20}px`; // Add some padding
      }
    }
  }, [isEditingDescription, textWidth]);

  // Measure text width when not editing
  useEffect(() => {
    if (!isEditingDescription && descriptionTextRef.current) {
      setTextWidth(descriptionTextRef.current.offsetWidth);
    }
  }, [isEditingDescription, customDescription]);

  useEffect(() => {
    setCustomDescription(prompt.description || '');
  }, [prompt.description]);

  // Generate a unique key for localStorage based on prompt name and server
  const getStorageKey = useCallback(() => {
    return `mcphub_prompt_form_${server ? `${server}_` : ''}${prompt.name}`;
  }, [prompt.name, server]);

  // Clear form data from localStorage
  const clearStoredFormData = useCallback(() => {
    localStorage.removeItem(getStorageKey());
  }, [getStorageKey]);

  const handleToggle = (enabled: boolean) => {
    if (!readOnly && onToggle) {
      onToggle(prompt.name, enabled);
    }
  };

  const handleDescriptionEdit = () => {
    if (readOnly) return;
    setIsEditingDescription(true);
  };

  const handleDescriptionSave = async () => {
    if (readOnly) return;
    setIsEditingDescription(false);
    try {
      const result = await updatePromptDescription(server, prompt.name, customDescription);
      if (result.success) {
        if (onDescriptionUpdate) {
          onDescriptionUpdate(prompt.name, customDescription);
        }
      } else {
        showToast(result.error || t('prompt.descriptionUpdateFailed'), 'error');
        // Revert to original description on failure
        setCustomDescription(prompt.description || '');
      }
    } catch (error) {
      console.error('Error updating prompt description:', error);
      showToast(t('prompt.descriptionUpdateFailed'), 'error');
      // Revert to original description on failure
      setCustomDescription(prompt.description || '');
    }
  };

  const handleDescriptionReset = async () => {
    if (readOnly) return;
    setIsResettingDescription(true);

    try {
      const result = await resetPromptDescription(server, prompt.name);
      if (result.success) {
        const restoredDescription = result.description || '';
        setCustomDescription(restoredDescription);
        setIsEditingDescription(false);
        onDescriptionUpdate?.(prompt.name, restoredDescription, { restored: true });
      } else {
        showToast(result.error || t('prompt.restoreDefaultFailed'), 'error');
      }
    } catch (error) {
      console.error('Error resetting prompt description:', error);
      showToast(t('prompt.restoreDefaultFailed'), 'error');
    } finally {
      setIsResettingDescription(false);
    }
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomDescription(e.target.value);
  };

  const handleDescriptionKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleDescriptionSave();
    } else if (e.key === 'Escape') {
      setCustomDescription(prompt.description || '');
      setIsEditingDescription(false);
    }
  };

  const handleGetPrompt = async (arguments_: Record<string, any>) => {
    setIsRunning(true);
    try {
      const result = await getPrompt({ promptName: prompt.name, arguments: arguments_ }, server);
      console.log('GetPrompt result:', result);
      setResult({
        success: result.success,
        data: result.data,
        error: result.error,
      });
      // Clear form data on successful submission
      // clearStoredFormData()
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    } finally {
      setIsRunning(false);
    }
  };

  const handleCancelRun = () => {
    setShowRunForm(false);
    // Clear form data when cancelled
    clearStoredFormData();
    setResult(null);
  };

  const handleCloseResult = () => {
    setResult(null);
  };

  const promptDisplayName = prompt.name.replace(server + nameSeparator, '');

  // Convert prompt arguments to ToolInputSchema format for DynamicForm
  const convertToSchema = () => {
    if (!prompt.arguments || prompt.arguments.length === 0) {
      return { type: 'object', properties: {}, required: [] };
    }

    const properties: Record<string, any> = {};
    const required: string[] = [];

    prompt.arguments.forEach((arg) => {
      properties[arg.name] = {
        type: 'string', // Default to string for prompts
        description: arg.description || '',
      };

      if (arg.required) {
        required.push(arg.name);
      }
    });

    return {
      type: 'object',
      properties,
      required,
    };
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
        <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
          <span className="hub-mono font-medium" style={{ fontSize: 13, color: 'var(--hub-ink)' }}>
            {promptDisplayName}
          </span>
          {prompt.title && (
            <span style={{ fontSize: 12, color: 'var(--hub-ink-2)' }}>{prompt.title}</span>
          )}
          <span className="flex items-center gap-1" style={{ fontSize: 12, color: 'var(--hub-ink-3)' }}>
            {isEditingDescription ? (
              <>
                <input
                  ref={descriptionInputRef}
                  type="text"
                  className="hub-input"
                  style={{ height: 26, fontSize: 12, width: textWidth > 0 ? `${textWidth + 20}px` : 160, minWidth: 80 }}
                  value={customDescription}
                  onChange={handleDescriptionChange}
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
                  title={t('prompt.restoreDefault')}
                  onClick={(e) => { e.stopPropagation(); handleDescriptionReset(); }}
                  disabled={isResettingDescription}
                  loading={isResettingDescription}
                />
              </>
            ) : (
              <>
                <span ref={descriptionTextRef}>
                  {customDescription || t('tool.noDescription')}
                </span>
                {!readOnly && (
                  <>
                    <button
                      className="hub-icon-btn sm"
                      onClick={(e) => { e.stopPropagation(); handleDescriptionEdit(); }}
                    >
                      <Edit size={12} />
                    </button>
                    <ResetDescriptionButton
                      title={t('prompt.restoreDefault')}
                      onClick={(e) => { e.stopPropagation(); handleDescriptionReset(); }}
                      disabled={isResettingDescription}
                      loading={isResettingDescription}
                    />
                  </>
                )}
              </>
            )}
          </span>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {cost != null && (
            <span
              className="hub-mono flex-shrink-0"
              style={{ fontSize: 11, color: 'var(--hub-ink-3)' }}
              title={t('cost.estimate')}
            >
              Σ {formatTokens(cost)}
            </span>
          )}
          <div className="flex h-[26px] items-center" onClick={(e) => e.stopPropagation()}>
            {prompt.enabled !== undefined && (
              <Switch
                checked={prompt.enabled}
                onCheckedChange={handleToggle}
                disabled={isRunning || readOnly}
                size="card"
                aria-label={`${t(prompt.enabled ? 'server.disable' : 'server.enable')} ${promptDisplayName}`}
              />
            )}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(true);
              setShowRunForm(true);
            }}
            className="hub-btn sm"
            style={{ color: 'var(--hub-accent)' }}
            disabled={isRunning || !prompt.enabled}
          >
            {isRunning ? <Loader size={12} className="animate-spin" /> : <Play size={12} />}
            <span>{isRunning ? t('tool.running') : t('tool.run')}</span>
          </button>
          <button className="hub-icon-btn sm">
            {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div style={{ borderTop: '1px solid var(--hub-line-2)', padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {/* Run Form */}
          {showRunForm && (
            <div style={{ border: '1px solid var(--hub-line)', borderRadius: 8, padding: 14 }}>
              <DynamicForm
                schema={convertToSchema()}
                onSubmit={handleGetPrompt}
                onCancel={handleCancelRun}
                loading={isRunning}
                storageKey={getStorageKey()}
                title={t('prompt.runPromptWithName', {
                  name: promptDisplayName,
                })}
              />
              {result && (
                <div style={{ marginTop: 12 }}>
                  <PromptResult result={result} onClose={handleCloseResult} />
                </div>
              )}
            </div>
          )}

          {/* Arguments Display (when not showing form) */}
          {!showRunForm && prompt.arguments && prompt.arguments.length > 0 && (
            <div style={{ background: 'var(--hub-bg-2)', borderRadius: 7, padding: '8px 12px', border: '1px solid var(--hub-line)' }}>
              <div className="hub-sect" style={{ marginBottom: 6 }}>{t('tool.parameters')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {prompt.arguments.map((arg, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <div className="flex-1">
                      <div className="flex items-center gap-1">
                        <span className="hub-mono" style={{ fontSize: 12.5, color: 'var(--hub-ink)' }}>{arg.name}</span>
                        {arg.required && <span style={{ color: 'var(--hub-err)', fontSize: 12 }}>*</span>}
                      </div>
                      {arg.description && (
                        <p style={{ fontSize: 12, color: 'var(--hub-ink-3)', margin: '2px 0 0' }}>{arg.description}</p>
                      )}
                    </div>
                    {arg.title && (
                      <span style={{ fontSize: 11, color: 'var(--hub-ink-3)' }}>{arg.title}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Result Display (when not showing form) */}
          {!showRunForm && result && (
            <div>
              <PromptResult result={result} onClose={handleCloseResult} />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default PromptCard;
