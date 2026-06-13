import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Tool } from '@/types';
import {
  ChevronDown,
  ChevronRight,
  Play,
  Loader,
  Edit,
  Check,
  Copy,
} from '@/components/icons/LucideIcons';
import {
  callTool,
  ToolCallResult,
  updateToolDescription,
  resetToolDescription,
} from '@/services/toolService';
import { useSettingsData } from '@/hooks/useSettingsData';
import { useToast } from '@/contexts/ToastContext';
import { Switch } from './ToggleGroup';
import DynamicForm from './DynamicForm';
import ToolResult from './ToolResult';
import ResetDescriptionButton from './ResetDescriptionButton';
import { formatTokens } from '@/utils/contextCost';
import { getToolDescriptionInfo } from '@/utils/toolDescription';

interface ToolCardProps {
  server: string;
  tool: Tool;
  readOnly?: boolean;
  onToggle?: (toolName: string, enabled: boolean) => void;
  onDescriptionUpdate?: (
    toolName: string,
    description: string,
    options?: { restored?: boolean },
  ) => void;
  cost?: number;
}

// Helper to check for "empty" values
function isEmptyValue(value: any): boolean {
  if (value == null) return true; // null or undefined
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

const ToolCard = ({ tool, server, readOnly = false, onToggle, onDescriptionUpdate, cost }: ToolCardProps) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const { nameSeparator } = useSettingsData();
  const [isExpanded, setIsExpanded] = useState(false);
  const [showRunForm, setShowRunForm] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<ToolCallResult | null>(null);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [isResettingDescription, setIsResettingDescription] = useState(false);
  const [customDescription, setCustomDescription] = useState(tool.description || '');
  const descriptionInputRef = useRef<HTMLInputElement>(null);
  const descriptionTextRef = useRef<HTMLSpanElement>(null);
  const [textWidth, setTextWidth] = useState<number>(0);
  const [copiedToolName, setCopiedToolName] = useState(false);

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
    setCustomDescription(tool.description || '');
  }, [tool.description]);

  const toolDisplayName = tool.name.replace(server + nameSeparator, '');
  const descriptionInfo = getToolDescriptionInfo(tool, t('tool.noDescription'));
  const defaultDescriptionTooltip = descriptionInfo.hasDescriptionOverride
    ? t('tool.defaultDescriptionTooltip', {
        description: descriptionInfo.defaultDescription,
      })
    : undefined;

  // Generate a unique key for localStorage based on tool name and server
  const getStorageKey = useCallback(() => {
    return `mcphub_tool_form_${server ? `${server}_` : ''}${tool.name}`;
  }, [tool.name, server]);

  // Clear form data from localStorage
  const clearStoredFormData = useCallback(() => {
    localStorage.removeItem(getStorageKey());
  }, [getStorageKey]);

  const handleToggle = (enabled: boolean) => {
    if (!readOnly && onToggle) {
      onToggle(tool.name, enabled);
    }
  };

  const handleDescriptionEdit = () => {
    if (readOnly) return;
    setIsEditingDescription(true);
  };

  const handleDescriptionSave = async () => {
    if (readOnly) return;
    try {
      const result = await updateToolDescription(server, tool.name, customDescription);
      if (result.success) {
        setIsEditingDescription(false);
        if (onDescriptionUpdate) {
          onDescriptionUpdate(tool.name, customDescription);
        }
      } else {
        // Revert on error
        setCustomDescription(tool.description || '');
        console.error('Failed to update tool description:', result.error);
      }
    } catch (error) {
      console.error('Error updating tool description:', error);
      setCustomDescription(tool.description || '');
      setIsEditingDescription(false);
    }
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomDescription(e.target.value);
  };

  const handleDescriptionReset = async () => {
    if (readOnly) return;
    setIsResettingDescription(true);

    try {
      const result = await resetToolDescription(server, tool.name);
      if (result.success) {
        const restoredDescription = result.description || '';
        setCustomDescription(restoredDescription);
        setIsEditingDescription(false);
        onDescriptionUpdate?.(tool.name, restoredDescription, { restored: true });
      } else {
        showToast(result.error || t('tool.restoreDefaultFailed'), 'error');
      }
    } catch (error) {
      console.error('Error resetting tool description:', error);
      showToast(t('tool.restoreDefaultFailed'), 'error');
    } finally {
      setIsResettingDescription(false);
    }
  };

  const handleDescriptionKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleDescriptionSave();
    } else if (e.key === 'Escape') {
      setCustomDescription(tool.description || '');
      setIsEditingDescription(false);
    }
  };

  const handleCopyToolName = async (e: React.MouseEvent) => {
    e.stopPropagation();

    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(tool.name);
        setCopiedToolName(true);
        showToast(t('common.copySuccess'), 'success');
        setTimeout(() => setCopiedToolName(false), 2000);
      } else {
        // Fallback for HTTP or unsupported clipboard API
        const textArea = document.createElement('textarea');
        textArea.value = tool.name;
        textArea.style.position = 'fixed';
        textArea.style.left = '-9999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
          setCopiedToolName(true);
          showToast(t('common.copySuccess'), 'success');
          setTimeout(() => setCopiedToolName(false), 2000);
        } catch (err) {
          showToast(t('common.copyFailed'), 'error');
          console.error('Copy to clipboard failed:', err);
        }
        document.body.removeChild(textArea);
      }
    } catch (error) {
      showToast(t('common.copyFailed'), 'error');
      console.error('Copy to clipboard failed:', error);
    }
  };

  const handleRunTool = async (arguments_: Record<string, any>) => {
    setIsRunning(true);
    try {
      // filter empty values
      arguments_ = Object.fromEntries(
        Object.entries(arguments_).filter(([_, v]) => !isEmptyValue(v)),
      );
      const result = await callTool(
        {
          toolName: tool.name,
          arguments: arguments_,
        },
        server,
      );

      setResult(result);
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

  return (
    <div
      className="hub-card overflow-hidden"
      style={{ marginBottom: 8 }}
    >
      <div
        className="flex justify-between items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-[var(--hub-surface-hover)] transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          setIsExpanded(!isExpanded);
        }}
      >
        <div className="flex-1 min-w-0 flex items-center gap-1.5 flex-wrap">
          <span className="hub-mono font-medium" style={{ fontSize: 13, color: 'var(--hub-ink)' }}>
            {toolDisplayName}
          </span>
          <button
            className="hub-icon-btn sm"
            onClick={handleCopyToolName}
            title={t('common.copy')}
          >
            {copiedToolName
              ? <Check size={12} style={{ color: 'var(--hub-ok)' }} />
              : <Copy size={12} />}
          </button>
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
                  title={t('tool.restoreDefault')}
                  onClick={(e) => { e.stopPropagation(); handleDescriptionReset(); }}
                  disabled={isResettingDescription}
                  loading={isResettingDescription}
                />
              </>
            ) : (
              <>
                <span ref={descriptionTextRef} title={defaultDescriptionTooltip}>
                  {descriptionInfo.currentDescription}
                </span>
                {descriptionInfo.hasDescriptionOverride && (
                  <span
                    className="inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium"
                    style={{
                      color: 'var(--hub-accent)',
                      borderColor: 'var(--hub-line)',
                      background: 'var(--hub-bg-2)',
                    }}
                    title={defaultDescriptionTooltip}
                  >
                    {t('tool.descriptionModifiedBadge')}
                  </span>
                )}
                {!readOnly && (
                  <>
                    <button
                      className="hub-icon-btn sm"
                      onClick={(e) => { e.stopPropagation(); handleDescriptionEdit(); }}
                    >
                      <Edit size={12} />
                    </button>
                    <ResetDescriptionButton
                      title={t('tool.restoreDefault')}
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
            <Switch
              checked={tool.enabled ?? true}
              onCheckedChange={handleToggle}
              disabled={isRunning || readOnly}
              size="card"
              aria-label={`${t((tool.enabled ?? true) ? 'server.disable' : 'server.enable')} ${toolDisplayName}`}
            />
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(true);
              setShowRunForm(true);
            }}
            className="hub-btn sm"
            style={{ color: 'var(--hub-accent)' }}
            disabled={isRunning || !tool.enabled}
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
          {descriptionInfo.hasDescriptionOverride && descriptionInfo.defaultDescription && (
            <div
              style={{
                background: 'var(--hub-bg-2)',
                borderRadius: 7,
                padding: '8px 12px',
                border: '1px dashed var(--hub-line)',
                fontSize: 11.5,
                color: 'var(--hub-ink-3)',
              }}
            >
              <span className="hub-sect" style={{ marginRight: 6 }}>
                {t('tool.defaultDescriptionLabel')}
              </span>
              <span className="whitespace-pre-wrap break-words">
                {descriptionInfo.defaultDescription}
              </span>
            </div>
          )}

          {/* Schema Display */}
          {!showRunForm && (
            <div style={{ background: 'var(--hub-bg-2)', borderRadius: 7, padding: '8px 12px', border: '1px solid var(--hub-line)' }}>
              <div className="hub-sect" style={{ marginBottom: 6 }}>{t('tool.inputSchema')}</div>
              <pre className="hub-mono overflow-auto" style={{ fontSize: 11.5, color: 'var(--hub-ink-2)', margin: 0 }}>
                {JSON.stringify(tool.inputSchema, null, 2)}
              </pre>
            </div>
          )}

          {/* Run Form */}
          {showRunForm && (
            <div style={{ border: '1px solid var(--hub-line)', borderRadius: 8, padding: 14 }}>
              <DynamicForm
                schema={tool.inputSchema || { type: 'object' }}
                onSubmit={handleRunTool}
                onCancel={handleCancelRun}
                loading={isRunning}
                storageKey={getStorageKey()}
                title={t('tool.runToolWithName', {
                  name: toolDisplayName,
                })}
              />
              {result && (
                <div style={{ marginTop: 12 }}>
                  <ToolResult result={result} onClose={handleCloseResult} />
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ToolCard;
