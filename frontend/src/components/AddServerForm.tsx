import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import ServerForm from './ServerForm'
import { getApiUrl } from '../utils/runtime';

interface AddServerFormProps {
  onAdd: () => void
}

const AddServerForm = ({ onAdd }: AddServerFormProps) => {
  const { t } = useTranslation()
  const [modalVisible, setModalVisible] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleModal = () => {
    setModalVisible(!modalVisible)
    setError(null) // Clear any previous errors when toggling modal
  }

  const handleSubmit = async (payload: any) => {
    try {
      setError(null)
      const token = localStorage.getItem('mcphub_token');
      const response = await fetch(getApiUrl('/servers'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-auth-token': token || ''
        },
        body: JSON.stringify(payload),
      })

      const result = await response.json()

      if (!response.ok) {
        // Use specific error message from the response if available
        if (result && result.message) {
          setError(result.message)
        } else if (response.status === 400) {
          setError(t('server.invalidData'))
        } else if (response.status === 409) {
          setError(t('server.alreadyExists', { serverName: payload.name }))
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

  return (
    <div>
      <button
        onClick={toggleModal}
        className="w-full bg-blue-100 text-blue-800 rounded hover:bg-blue-200 py-2 px-4 flex items-center justify-center"
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
    </div>
  )
}

export default AddServerForm