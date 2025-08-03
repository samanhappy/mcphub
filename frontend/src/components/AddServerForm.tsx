import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ServerForm from './ServerForm'
import { apiPost } from '../utils/fetchInterceptor'
import { detectVariables } from '../utils/variableDetection'

interface AddServerFormProps {
  onAdd: () => void
}

const AddServerForm = ({ onAdd }: AddServerFormProps) => {
  const { t } = useTranslation()
  const [modalVisible, setModalVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmationVisible, setConfirmationVisible] = useState(false)
  const [pendingPayload, setPendingPayload] = useState<any>(null)
  const [detectedVariables, setDetectedVariables] = useState<string[]>([])

  const toggleModal = () => {
    setModalVisible(!modalVisible)
    setError(null) // Clear any previous errors when toggling modal
    setConfirmationVisible(false) // Close confirmation dialog
    setPendingPayload(null) // Clear pending payload
  }

  const handleConfirmSubmit = async () => {
    if (pendingPayload) {
      await submitServer(pendingPayload)
      setConfirmationVisible(false)
      setPendingPayload(null)
    }
  }

  const submitServer = async (payload: any) => {
    try {
      setError(null)
      const result = await apiPost('/servers', payload)

      if (!result.success) {
        // Use specific error message from the response if available
        if (result && result.message) {
          setError(result.message)
        } else {
          setError(t('server.addError'))
        }
        return
      }

      setModalVisible(false)
      onAdd()
    } catch (err) {
      console.error('Error adding server:', err)

      // Use friendly error messages based on error type
      if (!navigator.onLine) {
        setError(t('errors.network'))
      } else if (err instanceof TypeError && (
        err.message.includes('NetworkError') ||
        err.message.includes('Failed to fetch')
      )) {
        setError(t('errors.serverConnection'))
      } else {
        setError(t('errors.serverAdd'))
      }
    }
  }

  const handleSubmit = async (payload: any) => {
    try {
      // Check for variables in the payload
      const variables = detectVariables(payload)

      if (variables.length > 0) {
        // Show confirmation dialog
        setDetectedVariables(variables)
        setPendingPayload(payload)
        setConfirmationVisible(true)
      } else {
        // Submit directly if no variables found
        await submitServer(payload)
      }
    } catch (err) {
      console.error('Error processing server submission:', err)
      setError(t('errors.serverAdd'))
    }
  }

  return (
    <div>
      <button
        onClick={toggleModal}
        className="w-full bg-blue-100 text-blue-800 rounded hover:bg-blue-200 py-2 px-4 flex items-center justify-center btn-primary"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-2" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
        </svg>
        {t('server.add')}
      </button>

      {modalVisible && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <ServerForm
            onSubmit={handleSubmit}
            onCancel={toggleModal}
            modalTitle={t('server.addServer')}
            formError={error}
          />
        </div>
      )}

      {confirmationVisible && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              {t('server.confirmVariables')}
            </h3>
            <p className="text-gray-600 mb-4">
              {t('server.variablesDetected')}
            </p>
            <div className="bg-yellow-50 border border-yellow-200 rounded p-3 mb-4">
              <div className="flex items-start">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-yellow-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h4 className="text-sm font-medium text-yellow-800">
                    {t('server.detectedVariables')}:
                  </h4>
                  <ul className="mt-1 text-sm text-yellow-700">
                    {detectedVariables.map((variable, index) => (
                      <li key={index} className="font-mono">
                        ${`{${variable}}`}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
            <p className="text-gray-600 text-sm mb-6">
              {t('server.confirmVariablesMessage')}
            </p>
            <div className="flex justify-end space-x-3">
              <button
                onClick={() => {
                  setConfirmationVisible(false)
                  setPendingPayload(null)
                }}
                className="px-4 py-2 text-gray-600 border border-gray-300 rounded hover:bg-gray-50 btn-secondary"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleConfirmSubmit}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 btn-primary"
              >
                {t('server.confirmAndAdd')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default AddServerForm