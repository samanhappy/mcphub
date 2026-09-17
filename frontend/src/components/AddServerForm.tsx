import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ServerForm from './ServerForm'
import { apiPost } from '../utils/fetchInterceptor'
import { detectVariables } from '../utils/variableDetection'
import { buildDuplicateSource, carryOverCapabilityOverrides } from '../utils/serverDuplicate'
import { Server } from '../types'

interface AddServerFormProps {
  onAdd: () => void
  /**
   * Source server for the card's Duplicate action (#1187). Setting it opens the
   * add modal pre-filled from that server and the copy is created through the
   * normal `POST /servers` path; clearing it closes the modal again.
   */
  duplicateSource?: Server | null
  onDuplicateCancel?: () => void
}

const AddServerForm = ({
  onAdd,
  duplicateSource = null,
  onDuplicateCancel,
}: AddServerFormProps) => {
  const { t } = useTranslation()
  const [addModalVisible, setAddModalVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmationVisible, setConfirmationVisible] = useState(false)
  const [pendingPayload, setPendingPayload] = useState<any>(null)
  const [detectedVariables, setDetectedVariables] = useState<string[]>([])

  const duplicatePrefill = useMemo(
    () => (duplicateSource ? buildDuplicateSource(duplicateSource) : null),
    [duplicateSource],
  )
  const modalVisible = addModalVisible || duplicateSource !== null

  const resetModalState = () => {
    setError(null) // Clear any previous errors when toggling modal
    setConfirmationVisible(false) // Close confirmation dialog
    setPendingPayload(null) // Clear pending payload
  }

  const closeModal = () => {
    setAddModalVisible(false)
    resetModalState()
    if (duplicateSource) {
      onDuplicateCancel?.()
    }
  }

  const toggleModal = () => {
    if (modalVisible) {
      closeModal()
      return
    }

    setAddModalVisible(true)
    resetModalState()
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

      closeModal()
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
      // The create payload is rebuilt from form fields, so a duplicate has to
      // get the source's capability overrides re-attached (#1187).
      const nextPayload = duplicateSource
        ? carryOverCapabilityOverrides(payload, duplicateSource)
        : payload

      // Check for variables in the payload
      const variables = detectVariables(nextPayload)

      if (variables.length > 0) {
        // Show confirmation dialog
        setDetectedVariables(variables)
        setPendingPayload(nextPayload)
        setConfirmationVisible(true)
      } else {
        // Submit directly if no variables found
        await submitServer(nextPayload)
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
        className="hub-btn primary"
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
        </svg>
        {t('server.add')}
      </button>

      {modalVisible && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <ServerForm
            onSubmit={handleSubmit}
            onCancel={closeModal}
            initialData={duplicatePrefill}
            mode="create"
            shareCandidatesFrom={duplicateSource?.name}
            modalTitle={
              duplicateSource
                ? t('server.duplicateTitle', { serverName: duplicateSource.name })
                : t('server.addServer')
            }
            formError={error}
          />
        </div>
      )}

      {confirmationVisible && (
        <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4">
          <div className="hub-card p-6 w-full max-w-md">
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
                className="hub-btn"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleConfirmSubmit}
                className="hub-btn primary"
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