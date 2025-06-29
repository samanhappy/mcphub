import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useGroupData } from '@/hooks/useGroupData'
import { useServerData } from '@/hooks/useServerData'
import { GroupFormData, Server } from '@/types'
import { ToggleGroup } from './ui/ToggleGroup'

interface AddGroupFormProps {
  onAdd: () => void
  onCancel: () => void
}

const AddGroupForm = ({ onAdd, onCancel }: AddGroupFormProps) => {
  const { t } = useTranslation()
  const { createGroup } = useGroupData()
  const { servers } = useServerData()
  const [availableServers, setAvailableServers] = useState<Server[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [formData, setFormData] = useState<GroupFormData>({
    name: '',
    description: '',
    servers: []
  })

  useEffect(() => {
    // Filter available servers (enabled only)
    setAvailableServers(servers.filter(server => server.enabled !== false))
  }, [servers])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({
      ...prev,
      [name]: value
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setError(null)

    try {
      if (!formData.name.trim()) {
        setError(t('groups.nameRequired'))
        setIsSubmitting(false)
        return
      }

      const result = await createGroup(formData.name, formData.description, formData.servers)

      if (!result) {
        setError(t('groups.createError'))
        setIsSubmitting(false)
        return
      }

      onAdd()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setIsSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-lg max-w-md w-full">
        <div className="p-6">
          <h2 className="text-xl font-semibold text-gray-800 mb-4">{t('groups.addNew')}</h2>

          {error && (
            <div className="mb-4 p-3 bg-red-100 text-red-700 rounded">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="mb-4">
              <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="name">
                {t('groups.name')} *
              </label>
              <input
                type="text"
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                className="shadow appearance-none border rounded w-full py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline form-input"
                placeholder={t('groups.namePlaceholder')}
                required
              />
            </div>

            <ToggleGroup
              className="mb-6"
              label={t('groups.servers')}
              noOptionsText={t('groups.noServerOptions')}
              values={formData.servers}
              options={availableServers.map(server => ({
                value: server.name,
                label: server.name
              }))}
              onChange={(servers) => setFormData(prev => ({ ...prev, servers }))}
            />

            <div className="flex justify-end space-x-3">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 text-gray-600 hover:text-gray-800 btn-secondary"
                disabled={isSubmitting}
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 btn-primary"
                disabled={isSubmitting}
              >
                {isSubmitting ? t('common.submitting') : t('common.create')}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}

export default AddGroupForm