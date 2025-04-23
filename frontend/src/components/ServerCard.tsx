import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Server } from '@/types'
import { ChevronDown, ChevronRight, AlertCircle, Copy, Check } from 'lucide-react'
import Badge from '@/components/ui/Badge'
import ToolCard from '@/components/ui/ToolCard'
import DeleteDialog from '@/components/ui/DeleteDialog'
import { useToast } from '@/contexts/ToastContext'

interface ServerCardProps {
  server: Server
  onRemove: (serverName: string) => void
  onEdit: (server: Server) => void
  onToggle?: (server: Server, enabled: boolean) => void
}

const ServerCard = ({ server, onRemove, onEdit, onToggle }: ServerCardProps) => {
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

  return (
    <>
      <div className={`bg-white shadow rounded-lg p-6 mb-6 ${server.enabled === false ? 'opacity-60' : ''}`}>
        <div
          className="flex justify-between items-center cursor-pointer"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          <div className="flex items-center space-x-3">
            <h2 className={`text-xl font-semibold ${server.enabled === false ? 'text-gray-600' : 'text-gray-900'}`}>{server.name}</h2>
            <Badge status={server.status} />
            
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
                          className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
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
              className="px-3 py-1 bg-blue-100 text-blue-800 rounded hover:bg-blue-200 text-sm"
            >
              {t('server.edit')}
            </button>
            <div className="flex items-center">
              <button
                onClick={handleToggle}
                className={`px-3 py-1 text-sm rounded transition-colors ${
                  isToggling 
                    ? 'bg-gray-200 text-gray-500' 
                    : server.enabled !== false
                      ? 'bg-green-100 text-green-800 hover:bg-green-200'
                      : 'bg-gray-100 text-gray-800 hover:bg-gray-200'
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
              className="px-3 py-1 bg-red-100 text-red-800 rounded hover:bg-red-200 text-sm"
            >
              {t('server.delete')}
            </button>
            <button className="text-gray-400 hover:text-gray-600">
              {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
            </button>
          </div>
        </div>

        {isExpanded && server.tools && (
          <div className="mt-6">
            <h3 className={`text-lg font-medium ${server.enabled === false ? 'text-gray-600' : 'text-gray-900'} mb-4`}>{t('server.tools')}</h3>
            <div className="space-y-4">
              {server.tools.map((tool, index) => (
                <ToolCard key={index} tool={tool} />
              ))}
            </div>
          </div>
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