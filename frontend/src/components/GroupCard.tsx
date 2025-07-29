import { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Group, Server, IGroupServerConfig } from '@/types'
import { Edit, Trash, Copy, Check, Link, FileCode, DropdownIcon, Wrench } from '@/components/icons/LucideIcons'
import DeleteDialog from '@/components/ui/DeleteDialog'
import { useToast } from '@/contexts/ToastContext'
import { useSettingsData } from '@/hooks/useSettingsData'

interface GroupCardProps {
  group: Group
  servers: Server[]
  onEdit: (group: Group) => void
  onDelete: (groupId: string) => void
}

const GroupCard = ({
  group,
  servers,
  onEdit,
  onDelete
}: GroupCardProps) => {
  const { t } = useTranslation()
  const { showToast } = useToast()
  const { installConfig } = useSettingsData()
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showCopyDropdown, setShowCopyDropdown] = useState(false)
  const [expandedServer, setExpandedServer] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowCopyDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const handleEdit = () => {
    onEdit(group)
  }

  const handleDelete = () => {
    setShowDeleteDialog(true)
  }

  const handleConfirmDelete = () => {
    onDelete(group.id)
    setShowDeleteDialog(false)
  }

  const copyToClipboard = (text: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(() => {
        setCopied(true)
        setShowCopyDropdown(false)
        showToast(t('common.copySuccess'), 'success')
        setTimeout(() => setCopied(false), 2000)
      })
    } else {
      // Fallback for HTTP or unsupported clipboard API
      const textArea = document.createElement('textarea')
      textArea.value = text
      // Avoid scrolling to bottom
      textArea.style.position = 'fixed'
      textArea.style.left = '-9999px'
      document.body.appendChild(textArea)
      textArea.focus()
      textArea.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        setShowCopyDropdown(false)
        showToast(t('common.copySuccess'), 'success')
        setTimeout(() => setCopied(false), 2000)
      } catch (err) {
        showToast(t('common.copyFailed') || 'Copy failed', 'error')
        console.error('Copy to clipboard failed:', err)
      }
      document.body.removeChild(textArea)
    }
  }

  const handleCopyId = () => {
    copyToClipboard(group.id)
  }

  const handleCopyUrl = () => {
    copyToClipboard(`${installConfig.baseUrl}/mcp/${group.id}`)
  }

  const handleCopyJson = () => {
    const jsonConfig = {
      mcpServers: {
        mcphub: {
          url: `${installConfig.baseUrl}/mcp/${group.id}`,
          headers: {
            Authorization: "Bearer <your-access-token>"
          }
        }
      }
    }
    copyToClipboard(JSON.stringify(jsonConfig, null, 2))
  }

  // Helper function to normalize group servers to get server names
  const getServerNames = (servers: string[] | IGroupServerConfig[]): string[] => {
    return servers.map(server => typeof server === 'string' ? server : server.name);
  };

  // Helper function to get server configuration
  const getServerConfig = (serverName: string): IGroupServerConfig | undefined => {
    const server = group.servers.find(s =>
      typeof s === 'string' ? s === serverName : s.name === serverName
    );
    if (typeof server === 'string') {
      return { name: server, tools: 'all' };
    }
    return server;
  };

  // Get servers that belong to this group
  const serverNames = getServerNames(group.servers);
  const groupServers = servers.filter(server => serverNames.includes(server.name));

  return (
    <div className="bg-white shadow rounded-lg p-6 ">
      <div className="flex justify-between items-center mb-4">
        <div>
          <div className="flex items-center">
            <h2 className="text-xl font-semibold text-gray-800">{group.name}</h2>
            <div className="flex items-center ml-3">
              <span className="text-xs text-gray-500 mr-1">{group.id}</span>
              <div className="relative" ref={dropdownRef}>
                <button
                  onClick={() => setShowCopyDropdown(!showCopyDropdown)}
                  className="p-1 text-gray-400 hover:text-gray-600 transition-colors flex items-center"
                  title={t('common.copy')}
                >
                  {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
                  <DropdownIcon size={12} className="ml-1" />
                </button>

                {showCopyDropdown && (
                  <div className="absolute top-full left-0 mt-1 bg-white shadow-lg rounded-md border border-gray-200 py-1 z-10 min-w-[140px]">
                    <button
                      onClick={handleCopyId}
                      className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center"
                    >
                      <Copy size={12} className="mr-2" />
                      {t('common.copyId')}
                    </button>
                    <button
                      onClick={handleCopyUrl}
                      className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center"
                    >
                      <Link size={12} className="mr-2" />
                      {t('common.copyUrl')}
                    </button>
                    <button
                      onClick={handleCopyJson}
                      className="w-full px-3 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center"
                    >
                      <FileCode size={12} className="mr-2" />
                      {t('common.copyJson')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
          {group.description && (
            <p className="text-gray-600 text-sm mt-1">{group.description}</p>
          )}
        </div>
        <div className="flex items-center space-x-3">
          <div className="bg-blue-50 text-blue-700 px-3 py-1 rounded-full text-sm btn-secondary">
            {t('groups.serverCount', { count: group.servers.length })}
          </div>
          <button
            onClick={handleEdit}
            className="text-gray-500 hover:text-gray-700"
            title={t('groups.edit')}
          >
            <Edit size={18} />
          </button>
          <button
            onClick={handleDelete}
            className="text-gray-500 hover:text-red-600"
            title={t('groups.delete')}
          >
            <Trash size={18} />
          </button>
        </div>
      </div>

      <div className="mt-4">
        {groupServers.length === 0 ? (
          <p className="text-gray-500 italic">{t('groups.noServers')}</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {groupServers.map(server => {
              const serverConfig = getServerConfig(server.name);
              const hasToolRestrictions = serverConfig && serverConfig.tools !== 'all' && Array.isArray(serverConfig.tools);
              const toolCount = hasToolRestrictions && Array.isArray(serverConfig?.tools)
                ? serverConfig.tools.length
                : (server.tools?.length || 0); // Show total tool count when all tools are selected

              const isExpanded = expandedServer === server.name;

              // Get tools list for display
              const getToolsList = () => {
                if (hasToolRestrictions && Array.isArray(serverConfig?.tools)) {
                  return serverConfig.tools;
                } else if (server.tools && server.tools.length > 0) {
                  return server.tools.map(tool => tool.name);
                }
                return [];
              };

              const handleServerClick = () => {
                setExpandedServer(isExpanded ? null : server.name);
              };

              return (
                <div key={server.name} className="relative">
                  <div
                    className="flex items-center space-x-2 bg-gray-50 rounded-lg px-3 py-2 cursor-pointer hover:bg-gray-100 transition-colors"
                    onClick={handleServerClick}
                  >
                    <span className="font-medium text-gray-700 text-sm">{server.name}</span>
                    <span className={`inline-block h-2 w-2 rounded-full ${server.status === 'connected' ? 'bg-green-500' :
                      server.status === 'connecting' ? 'bg-yellow-500' : 'bg-red-500'
                      }`}></span>
                    {toolCount > 0 && (
                      <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded flex items-center gap-1">
                        <Wrench size={12} />
                        {toolCount}
                      </span>
                    )}
                  </div>

                  {isExpanded && (
                    <div className="absolute top-full left-0 mt-1 bg-white shadow-lg rounded-md border border-gray-200 p-3 z-10 min-w-[300px] max-w-[400px]">
                      <div className="text-gray-600 text-xs mb-2">
                        {hasToolRestrictions ? t('groups.selectedTools') : t('groups.allTools')}:
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {getToolsList().map((toolName, index) => (
                          <span
                            key={index}
                            className="inline-block bg-gray-100 text-gray-700 px-2 py-1 rounded text-xs"
                          >
                            {toolName}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <DeleteDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleConfirmDelete}
        serverName={group.name}
        isGroup={true}
      />
    </div>
  )
}

export default GroupCard