import { useState, useCallback, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Prompt } from '@/types'
import { ChevronDown, ChevronRight, Play, Loader, Edit, Check } from '@/components/icons/LucideIcons'
import { Switch } from './ToggleGroup'
import { getPrompt, PromptCallResult } from '@/services/promptService'
import DynamicForm from './DynamicForm'
import PromptResult from './PromptResult'

interface PromptCardProps {
  server: string
  prompt: Prompt
  onToggle?: (promptName: string, enabled: boolean) => void
  onDescriptionUpdate?: (promptName: string, description: string) => void
}

const PromptCard = ({ prompt, server, onToggle, onDescriptionUpdate }: PromptCardProps) => {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const [showRunForm, setShowRunForm] = useState(false)
  const [isRunning, setIsRunning] = useState(false)
  const [result, setResult] = useState<PromptCallResult | null>(null)
  const [isEditingDescription, setIsEditingDescription] = useState(false)
  const [customDescription, setCustomDescription] = useState(prompt.description || '')
  const descriptionInputRef = useRef<HTMLInputElement>(null)
  const descriptionTextRef = useRef<HTMLSpanElement>(null)
  const [textWidth, setTextWidth] = useState<number>(0)

  // Focus the input when editing mode is activated
  useEffect(() => {
    if (isEditingDescription && descriptionInputRef.current) {
      descriptionInputRef.current.focus()
      // Set input width to match text width
      if (textWidth > 0) {
        descriptionInputRef.current.style.width = `${textWidth + 20}px` // Add some padding
      }
    }
  }, [isEditingDescription, textWidth])

  // Measure text width when not editing
  useEffect(() => {
    if (!isEditingDescription && descriptionTextRef.current) {
      setTextWidth(descriptionTextRef.current.offsetWidth)
    }
  }, [isEditingDescription, customDescription])

  // Generate a unique key for localStorage based on prompt name and server
  const getStorageKey = useCallback(() => {
    return `mcphub_prompt_form_${server ? `${server}_` : ''}${prompt.name}`
  }, [prompt.name, server])

  // Clear form data from localStorage
  const clearStoredFormData = useCallback(() => {
    localStorage.removeItem(getStorageKey())
  }, [getStorageKey])

  const handleToggle = (enabled: boolean) => {
    if (onToggle) {
      onToggle(prompt.name, enabled)
    }
  }

  const handleDescriptionEdit = () => {
    setIsEditingDescription(true)
  }

  const handleDescriptionSave = async () => {
    // For now, we'll just update the local state
    // In a real implementation, you would call an API to update the description
    setIsEditingDescription(false)
    if (onDescriptionUpdate) {
      onDescriptionUpdate(prompt.name, customDescription)
    }
  }

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCustomDescription(e.target.value)
  }

  const handleDescriptionKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleDescriptionSave()
    } else if (e.key === 'Escape') {
      setCustomDescription(prompt.description || '')
      setIsEditingDescription(false)
    }
  }

  const handleGetPrompt = async (arguments_: Record<string, any>) => {
    setIsRunning(true)
    try {
      const result = await getPrompt({ promptName: prompt.name, arguments: arguments_ }, server)
      console.log('GetPrompt result:', result)
      setResult({
        success: result.success,
        data: result.data,
        error: result.error
      })
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

  // Convert prompt arguments to ToolInputSchema format for DynamicForm
  const convertToSchema = () => {
    if (!prompt.arguments || prompt.arguments.length === 0) {
      return { type: 'object', properties: {}, required: [] }
    }

    const properties: Record<string, any> = {}
    const required: string[] = []

    prompt.arguments.forEach(arg => {
      properties[arg.name] = {
        type: 'string', // Default to string for prompts
        description: arg.description || ''
      }

      if (arg.required) {
        required.push(arg.name)
      }
    })

    return {
      type: 'object',
      properties,
      required
    }
  }

  return (
    <div className="bg-white border border-gray-200 shadow rounded-lg p-4 mb-4">
      <div
        className="flex justify-between items-center cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex-1">
          <h3 className="text-lg font-medium text-gray-900">
            {prompt.name.replace(server + '-', '')}
            {prompt.title && (
              <span className="ml-2 text-sm font-normal text-gray-600">
                {prompt.title}
              </span>
            )}
            <span className="ml-2 text-sm font-normal text-gray-500 inline-flex items-center">
              {isEditingDescription ? (
                <>
                  <input
                    ref={descriptionInputRef}
                    type="text"
                    className="px-2 py-1 border border-blue-300 rounded bg-white text-sm focus:outline-none form-input"
                    value={customDescription}
                    onChange={handleDescriptionChange}
                    onKeyDown={handleDescriptionKeyDown}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                      minWidth: '100px',
                      width: textWidth > 0 ? `${textWidth + 20}px` : 'auto'
                    }}
                  />
                  <button
                    className="ml-2 p-1 text-green-600 hover:text-green-800 cursor-pointer transition-colors"
                    onClick={(e) => {
                      e.stopPropagation()
                      handleDescriptionSave()
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
                      e.stopPropagation()
                      handleDescriptionEdit()
                    }}
                  >
                    <Edit size={14} />
                  </button>
                </>
              )}
            </span>
          </h3>
        </div>
        <div className="flex items-center space-x-2">
          <div
            className="flex items-center space-x-2"
            onClick={(e) => e.stopPropagation()}
          >
            {prompt.enabled !== undefined && (
              <Switch
                checked={prompt.enabled}
                onCheckedChange={handleToggle}
                disabled={isRunning}
              />
            )}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation()
              setIsExpanded(true) // Ensure card is expanded when showing run form
              setShowRunForm(true)
            }}
            className="flex items-center space-x-1 px-3 py-1 text-sm text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors btn-primary"
            disabled={isRunning || !prompt.enabled}
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
          {/* Run Form */}
          {showRunForm && (
            <div className="border border-gray-300 rounded-lg p-4">
              <DynamicForm
                schema={convertToSchema()}
                onSubmit={handleGetPrompt}
                onCancel={handleCancelRun}
                loading={isRunning}
                storageKey={getStorageKey()}
                title={t('prompt.runPromptWithName', { name: prompt.name.replace(server + '-', '') })}
              />
              {/* Prompt Result */}
              {result && (
                <div className="mt-4">
                  <PromptResult result={result} onClose={handleCloseResult} />
                </div>
              )}
            </div>
          )}

          {/* Arguments Display (when not showing form) */}
          {!showRunForm && prompt.arguments && prompt.arguments.length > 0 && (
            <div className="bg-gray-50 rounded p-3 border border-gray-300">
              <h4 className="text-sm font-medium text-gray-900 mb-2">{t('tool.parameters')}</h4>
              <div className="space-y-2">
                {prompt.arguments.map((arg, index) => (
                  <div key={index} className="flex items-start">
                    <div className="flex-1">
                      <div className="flex items-center">
                        <span className="font-medium text-gray-700">{arg.name}</span>
                        {arg.required && <span className="text-red-500 ml-1">*</span>}
                      </div>
                      {arg.description && (
                        <p className="text-sm text-gray-600 mt-1">{arg.description}</p>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 ml-2">
                      {arg.title || ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Result Display (when not showing form) */}
          {!showRunForm && result && (
            <div className="mt-4">
              <PromptResult result={result} onClose={handleCloseResult} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default PromptCard
