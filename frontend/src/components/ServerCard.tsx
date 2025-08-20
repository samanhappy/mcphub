import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Server } from '@/types'
import { ChevronDown, ChevronRight, AlertCircle, Copy, Check } from 'lucide-react'
import { StatusBadge } from '@/components/ui/Badge'
import ToolCard from '@/components/ui/ToolCard'
import PromptCard from '@/components/ui/PromptCard'
import DeleteDialog from '@/components/ui/DeleteDialog'
import { useToast } from '@/contexts/ToastContext'

interface ServerCardProps {
  server: Server
  onRemove: (serverName: string) => void
  onEdit: (server: Server) => void
  onToggle?: (server: Server, enabled: boolean) => Promise<boolean>
  onRefresh?: () => void
}

const ServerCard = ({ server, onRemove, onEdit, onToggle, onRefresh }: ServerCardProps) => {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const [isExpanded, setIsExpanded] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isToggling, setIsToggling] = useState(false)
  const [showErrorPopover, setShowErrorPopover] = useState(false)
  const [copied, setCopied] = useState(false)
  const errorPopoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (errorPopoverRef.current && !errorPopoverRef.current.contains(event.target as Node)) {
        setShowErrorPopover(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowDeleteDialog(true)
  }

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation()
    onEdit(server)
  }

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (isToggling || !onToggle) return

    setIsToggling(true)
    try {
      await onToggle(server, !(server.enabled !== false))
    } finally {
      setIsToggling(false)
    }
  }

  const handleErrorIconClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShowErrorPopover(!showErrorPopover)
  }

  const copyToClipboard = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!server.error) return

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(server.error).then(() => {
        setCopied(true)
        showToast(t('common.copySuccess') || 'Copied to clipboard', 'success')
        setTimeout(() => setCopied(false), 2000)
      })
    } else {
      // Fallback for HTTP or unsupported clipboard API
      const textArea = document.createElement('textarea')
      textArea.value = server.error
      // Avoid scrolling to bottom
      textArea.style.position = 'fixed'
      textArea.style.left = '-9999px'
      document.body.appendChild(textArea)
      textArea.focus()
      textArea.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        showToast(t('common.copySuccess') || 'Copied to clipboard', 'success')
        setTimeout(() => setCopied(false), 2000)
      } catch (err) {
        showToast(t('common.copyFailed') || 'Copy failed', 'error')
        console.error('Copy to clipboard failed:', err)
      }
      document.body.removeChild(textArea)
    }
  }

  const handleConfirmDelete = () => {
    onRemove(server.name)
    setShowDeleteDialog(false)
  }

  const handleToolToggle = async (toolName: string, enabled: boolean) => {
    try {
      const { toggleTool } = await import('@/services/toolService')
      const result = await toggleTool(server.name, toolName, enabled)
      if (result.success) {
        showToast(
          t(enabled ? 'tool.enableSuccess' : 'tool.disableSuccess', { name: toolName }),
          'success'
        )
        // Trigger refresh to update the tool's state in the UI
        if (onRefresh) {
          onRefresh()
        }
      } else {
        showToast(result.error || t('tool.toggleFailed'), 'error')
      }
    } catch (error) {
      console.error('Error toggling tool:', error)
      showToast(t('tool.toggleFailed'), 'error')
    }
  }

  const handlePromptToggle = async (promptName: string, enabled: boolean) => {
    try {
      const { togglePrompt } = await import('@/services/promptService')
      const result = await togglePrompt(server.name, promptName, enabled)
      if (result.success) {
        showToast(
          t(enabled ? 'tool.enableSuccess' : 'tool.disableSuccess', { name: promptName }),
          'success'
        )
        // Trigger refresh to update the prompt's state in the UI
        if (onRefresh) {
          onRefresh()
        }
      } else {
        showToast(result.error || t('tool.toggleFailed'), 'error')
      }
    } catch (error) {
      console.error('Error toggling prompt:', error)
      showToast(t('tool.toggleFailed'), 'error')
    }
  }

  return (
    <>
      <div className={`bg-white shadow rounded-lg p-6 mb-6 page-card transition-all duration-200 ${server.enabled === false ? 'opacity-60' : ''}`}>
        <div
          className="flex justify-between items-center cursor-pointer"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center space-x-3">
            <h2 className={`text-xl font-semibold ${server.enabled === false ? 'text-gray-600' : 'text-gray-900'}`}>{server.name}</h2>
            <StatusBadge status={server.status} />

            {/* Tool count display */}
            <div className="flex items-center px-2 py-1 bg-blue-50 text-blue-700 rounded-full text-sm btn-primary">
              <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
              </svg>
              <span>{server.tools?.length || 0} {t('server.tools')}</span>
            </div>

            {/* Prompt count display */}
            <div className="flex items-center px-2 py-1 bg-purple-50 text-purple-700 rounded-full text-sm btn-primary">
              <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 5a2 2 0 012-2h7a2 2 0 012 2v4a2 2 0 01-2 2H9l-3 3v-3H4a2 2 0 01-2-2V5z" />
                <path d="M15 7v2a4 4 0 01-4 4H9.828l-1.766 1.767c.28.149.599.233.938.233h2l3 3v-3h2a2 2 0 002-2V9a2 2 0 00-2-2h-1z" />
              </svg>
              <span>{server.prompts?.length || 0} {t('server.prompts')}</span>
            </div>

            {server.error && (
              <div className="relative">
                <div
                  className="cursor-pointer"
                  onClick={handleErrorIconClick}
                  aria-label={t('server.viewErrorDetails')}
                >
                  <AlertCircle className="text-red-500 hover:text-red-600" size={18} />
                </div>

                {showErrorPopover && (
                  <div
                    ref={errorPopoverRef}
                    className="absolute z-10 mt-2 bg-white border border-gray-200 rounded-md shadow-lg p-0 w-120"
                    style={{
                      left: '-231px',
                      top: '24px',
                      maxHeight: '300px',
                      overflowY: 'auto',
                      width: '480px',
                      transform: 'translateX(50%)'
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex justify-between items-center sticky top-0 bg-white py-2 px-4 border-b border-gray-200 z-20 shadow-sm">
                      <div className="flex items-center space-x-2">
                        <h4 className="text-sm font-medium text-red-600">{t('server.errorDetails')}</h4>
                        <button
                          onClick={copyToClipboard}
                          className="p-1 text-gray-400 hover:text-gray-600 transition-colors btn-secondary"
                          title={t('common.copy')}
                        >
                          {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                        </button>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setShowErrorPopover(false)
                        }}
                        className="text-gray-400 hover:text-gray-600"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="p-4 pt-2">
                      <pre className="text-sm text-gray-700 break-words whitespace-pre-wrap">{server.error}</pre>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex space-x-2">
            <button
              onClick={handleEdit}
              className="px-3 py-1 bg-blue-100 text-blue-800 rounded hover:bg-blue-200 text-sm btn-primary"
            >
              {t('server.edit')}
            </button>
            <div className="flex items-center">
              <button
                onClick={handleToggle}
                className={`px-3 py-1 text-sm rounded transition-colors ${isToggling
                  ? 'bg-gray-200 text-gray-500'
                  : server.enabled !== false
                    ? 'bg-green-100 text-green-800 hover:bg-green-200 btn-secondary'
                    : 'bg-gray-100 text-gray-800 hover:bg-gray-200 btn-primary'
                  }`}
                disabled={isToggling}
              >
                {isToggling
                  ? t('common.processing')
                  : server.enabled !== false
                    ? t('server.disable')
                    : t('server.enable')
                }
              </button>
            </div>
            <button
              onClick={handleRemove}
              className="px-3 py-1 bg-red-100 text-red-800 rounded hover:bg-red-200 text-sm btn-danger"
            >
              {t('server.delete')}
            </button>
            <button className="text-gray-400 hover:text-gray-600 btn-secondary">
              {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            </button>
          </div>
        </div>

        {isExpanded && (
          <>
            {server.tools && (
              <div className="mt-6">
                <h6 className={`font-medium ${server.enabled === false ? 'text-gray-600' : 'text-gray-900'} mb-4`}>{t('server.tools')}</h6>
                <div className="space-y-4">
                  {server.tools.map((tool, index) => (
                    <ToolCard key={index} server={server.name} tool={tool} onToggle={handleToolToggle} />
                  ))}
                </div>
              </div>
            )}

            {server.prompts && (
              <div className="mt-6">
                <h6 className={`font-medium ${server.enabled === false ? 'text-gray-600' : 'text-gray-900'} mb-4`}>{t('server.prompts')}</h6>
                <div className="space-y-4">
                  {server.prompts.map((prompt, index) => (
                    <PromptCard 
                      key={index} 
                      server={server.name} 
                      prompt={prompt} 
                      onToggle={handlePromptToggle} 
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <DeleteDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleConfirmDelete}
        serverName={server.name}
      />
    </>
  )
}

export default ServerCard