import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Server } from '@/types'
import { ChevronDown, ChevronRight } from '@/components/icons/LucideIcons'
import Badge from '@/components/ui/Badge'
import ToolCard from '@/components/ui/ToolCard'
import DeleteDialog from '@/components/ui/DeleteDialog'

interface ServerCardProps {
  server: Server
  onRemove: (serverName: string) => void
  onEdit: (server: Server) => void
  onToggle?: (server: Server, enabled: boolean) => void
}

const ServerCard = ({ server, onRemove, onEdit, onToggle }: ServerCardProps) => {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [isToggling, setIsToggling] = useState(false)

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

  const handleConfirmDelete = () => {
    onRemove(server.name)
    setShowDeleteDialog(false)
  }

  return (
    <div className={`bg-white shadow rounded-lg p-6 mb-6 ${server.enabled === false ? 'opacity-60' : ''}`}>
      <div
        className="flex justify-between items-center cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center space-x-3">
          <h2 className={`text-xl font-semibold ${server.enabled === false ? 'text-gray-600' : 'text-gray-900'}`}>{server.name}</h2>
          <Badge status={server.status} />
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

      <DeleteDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleConfirmDelete}
        serverName={server.name}
      />

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
  )
}

export default ServerCard