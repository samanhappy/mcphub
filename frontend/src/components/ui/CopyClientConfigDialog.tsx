import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy, X } from 'lucide-react';
import {
  buildClientSnippetBlocks,
  CLIENT_SNIPPET_PRESETS,
  DEFAULT_CLIENT_SNIPPET_ID,
  type ClientSnippetId,
  type ClientSnippetTarget,
} from '@/utils/mcpClientSnippets';
import { copyText } from '@/utils/clipboard';
import { useToast } from '@/contexts/ToastContext';

interface CopyClientConfigDialogProps {
  isOpen: boolean;
  onClose: () => void;
  /** Target to render; `null` keeps the dialog closed. */
  target: ClientSnippetTarget | null;
}

/**
 * Per-client MCP configuration presets for the copy actions (#1165): one tab
 * per client, each with the path it belongs in and a ready-to-paste snippet.
 */
const CopyClientConfigDialog = ({ isOpen, onClose, target }: CopyClientConfigDialogProps) => {
  const { t } = useTranslation();
  const { showToast } = useToast();
  const [activeId, setActiveId] = useState<ClientSnippetId>(DEFAULT_CLIENT_SNIPPET_ID);
  const [copiedBlock, setCopiedBlock] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setCopiedBlock(null);
      setActiveId(DEFAULT_CLIENT_SNIPPET_ID);
    }
  }, [isOpen]);

  // Like the other hand-rolled modals in this codebase the dialog does not trap
  // focus; it does move focus inside on open and hand it back to the trigger on
  // close, so keyboard users are not left behind on the page underneath.
  useEffect(() => {
    if (!isOpen) return;
    returnFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();

    return () => {
      returnFocusRef.current?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const blocks = useMemo(
    () =>
      target
        ? buildClientSnippetBlocks(activeId, target, {
            tokenPromptDescription: t('clientConfig.tokenPrompt'),
          })
        : [],
    [activeId, target, t],
  );

  if (!isOpen || !target) {
    return null;
  }

  const handleCopy = async (key: string, value: string) => {
    const ok = await copyText(value);
    if (!ok) {
      showToast(t('common.copyFailed'), 'error');
      return;
    }
    setCopiedBlock(key);
    showToast(t('common.copySuccess'), 'success');
    setTimeout(() => setCopiedBlock((current) => (current === key ? null : current)), 1500);
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="hub-card w-full max-w-2xl"
        role="dialog"
        aria-modal="true"
        aria-label={t('clientConfig.title')}
      >
        <div
          className="flex items-start justify-between gap-3 px-4 py-3"
          style={{ borderBottom: '1px solid var(--hub-line-2)' }}
        >
          <div className="min-w-0">
            <div className="text-[14px] font-medium" style={{ color: 'var(--hub-ink)' }}>
              {t('clientConfig.title')}
            </div>
            <div className="text-[12px] mt-0.5" style={{ color: 'var(--hub-ink-3)' }}>
              {t('clientConfig.description', { name: target.name })}
            </div>
          </div>
          <button className="hub-icon-btn sm" onClick={onClose} aria-label={t('app.closeButton')}>
            <X size={13} />
          </button>
        </div>

        {/* A target with neither URL nor command (OpenAPI-backed servers) has no
            transport, so every preset returns the same empty result: offering 14
            clickable tabs would only suggest the dialog is broken. The tab strip
            and its per-client hint are therefore hidden and only the explanation
            below is shown. */}
        {blocks.length > 0 && (
          <div className="px-4 pt-3">
            <div
              className="flex flex-wrap gap-1"
              role="tablist"
              aria-label={t('clientConfig.title')}
            >
              {CLIENT_SNIPPET_PRESETS.map((preset) => {
                const active = preset.id === activeId;
                return (
                  <button
                    key={preset.id}
                    role="tab"
                    aria-selected={active}
                    onClick={() => setActiveId(preset.id)}
                    className="px-2.5 py-1 rounded-md text-[12px] transition-colors hover:bg-[var(--hub-surface-hover)]"
                    style={{
                      background: active ? 'var(--hub-surface)' : 'transparent',
                      border: '1px solid ' + (active ? 'var(--hub-line)' : 'transparent'),
                      color: active ? 'var(--hub-ink)' : 'var(--hub-ink-2)',
                    }}
                  >
                    {t(`clientConfig.clients.${preset.id}.label`)}
                  </button>
                );
              })}
            </div>

            <p className="text-[12px] mt-3" style={{ color: 'var(--hub-ink-3)' }}>
              {t(`clientConfig.clients.${activeId}.hint`)}
            </p>
          </div>
        )}

        <div className="px-4 pb-4 pt-2 space-y-3 max-h-[60vh] overflow-auto">
          {blocks.length === 0 ? (
            // OpenAPI-backed servers have no client-side transport to copy.
            <p className="text-[12px]" style={{ color: 'var(--hub-ink-3)' }}>
              {t('clientConfig.noTransport')}
            </p>
          ) : (
            blocks.map((block) => {
              const key = `${activeId}:${block.kind}`;
              const copied = copiedBlock === key;
              return (
                <div key={key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px]" style={{ color: 'var(--hub-ink-2)' }}>
                      {t(
                        block.kind === 'command'
                          ? 'clientConfig.commandBlock'
                          : 'clientConfig.configBlock',
                      )}
                    </span>
                    <button
                      className="hub-btn sm"
                      onClick={() => void handleCopy(key, block.text)}
                    >
                      {copied ? <Check size={12} className="text-[var(--hub-ok)]" /> : <Copy size={12} />}
                      {copied ? t('clientConfig.copied') : t('common.copy')}
                    </button>
                  </div>
                  <pre
                    className="hub-mono m-0 p-3 rounded-md overflow-auto"
                    style={{
                      background: 'var(--hub-bg-2)',
                      border: '1px solid var(--hub-line-2)',
                      fontSize: 12,
                      lineHeight: 1.5,
                      color: 'var(--hub-ink-2)',
                      maxHeight: 320,
                    }}
                  >
                    <code>{block.text}</code>
                  </pre>
                </div>
              );
            })
          )}
        </div>

        <div
          className="flex justify-end px-4 py-3"
          style={{ borderTop: '1px solid var(--hub-line-2)' }}
        >
          <button className="hub-btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CopyClientConfigDialog;
