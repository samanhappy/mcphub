import { useState, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Tool } from '@/types'
import { ChevronDown, ChevronRight, Play, Loader } from '@/components/icons/LucideIcons'
import { callTool, ToolCallResult } from '@/services/toolService'
import DynamicForm from './DynamicForm'
import ToolResult from './ToolResult'

interface ToolCardProps {
  server: string
  tool: Tool
}

const ToolCard = ({ tool, server }: ToolCardProps) => {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const [showRunForm, setShowRunForm] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [result, setResult] = useState<ToolCallResult | null>(null)

  // Generate a unique key for localStorage based on tool name and server
  const getStorageKey = useCallback(() => {
    return `mcphub_tool_form_${server ? `${server}_` : ''}${tool.name}`
  }, [tool.name, server])

  // Clear form data from localStorage
  const clearStoredFormData = useCallback(() => {
    localStorage.removeItem(getStorageKey())
  }, [getStorageKey])

  const handleRunTool = async (arguments_: Record<string, any>) => {
    setIsRunning(true)
    try {
      const result = await callTool({
        toolName: tool.name,
        arguments: arguments_,
      }, server)

      setResult(result)
      // Clear form data on successful submission
      // clearStoredFormData()
    } catch (error) {
      setResult({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      })
    } finally {
      setIsRunning(false)
    }
  }

  const handleCancelRun = () => {
    setShowRunForm(false)
    // Clear form data when cancelled
    clearStoredFormData()
    setResult(null)
  }

  const handleCloseResult = () => {
    setResult(null)
  }

  return (
    <div className="bg-white border border-gray-300 shadow rounded-lg p-4 mb-4">
      <div
        className="flex justify-between items-center cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex-1">
          <h3 className="text-lg font-medium text-gray-900">
            {tool.name}
            <span className="ml-2 text-sm font-normal text-gray-600">
              {tool.description || t('tool.noDescription')}
            </span>
          </h3>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setIsExpanded(true) // Ensure card is expanded when showing run form
              setShowRunForm(true)
            }}
            className="flex items-center space-x-1 px-3 py-1 text-sm text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
            disabled={isRunning}
          >
            {isRunning ? (
              <Loader size={14} className="animate-spin" />
            ) : (
              <Play size={14} />
            )}
            <span>{isRunning ? t('tool.running') : t('tool.run')}</span>
          </button>
          <button className="text-gray-400 hover:text-gray-600">
            {isExpanded ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="mt-4 space-y-4">
          {/* Schema Display */}
          {!showRunForm && (
            <div className="bg-gray-50 rounded p-3 border border-gray-300">
              <h4 className="text-sm font-medium text-gray-900 mb-2">{t('tool.inputSchema')}</h4>
              <pre className="text-xs text-gray-600 overflow-auto">
                {JSON.stringify(tool.inputSchema, null, 2)}
              </pre>
            </div>
          )}

          {/* Run Form */}
          {showRunForm && (
            <div className="border border-gray-300 rounded-lg p-4 bg-blue-50">
              <h4 className="text-sm font-medium text-gray-900 mb-3">{t('tool.runToolWithName', { name: tool.name })}</h4>
              <DynamicForm
                schema={tool.inputSchema || { type: 'object' }}
                onSubmit={handleRunTool}
                onCancel={handleCancelRun}
                loading={isRunning}
                storageKey={getStorageKey()}
              />
              {/* Tool Result */}
              {result && (
                <div className="mt-4">
                  <ToolResult result={result} onClose={handleCloseResult} />
                </div>
              )}
            </div>
          )}


        </div>
      )}
    </div>
  )
}

export default ToolCard