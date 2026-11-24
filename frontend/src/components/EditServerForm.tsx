import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Server } from '@/types';
import { apiPut } from '../utils/fetchInterceptor';
import ServerForm from './ServerForm';

interface EditServerFormProps {
  server: Server;
  onEdit: () => void;
  onCancel: () => void;
}

const EditServerForm = ({ server, onEdit, onCancel }: EditServerFormProps) => {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (payload: any) => {
    setIsSubmitting(true);
    try {
      setError(null);
      const encodedServerName = encodeURIComponent(server.name);

      // Check if name is being changed
      const isRenaming = payload.name && payload.name !== server.name;

      // Build the request body
      const requestBody = {
        config: payload.config,
        ...(isRenaming ? { newName: payload.name } : {}),
      };

      const result = await apiPut(`/servers/${encodedServerName}`, requestBody);

      if (!result.success) {
        if (result && result.message) {
          setError(result.message);
        } else {
          setError(t('server.updateError', { serverName: server.name }));
        }
        return;
      }

      onEdit();
    } catch (err) {
      console.error('Error updating server:', err);

      if (!navigator.onLine) {
        setError(t('errors.network'));
      } else if (
        err instanceof TypeError &&
        (err.message.includes('NetworkError') || err.message.includes('Failed to fetch'))
      ) {
        setError(t('errors.serverConnection'));
      } else {
        setError(t('errors.serverUpdate', { serverName: server.name }));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      {/* B1 (edit path): keyed on the server name so switching the editing
          target forces ServerForm to remount. */}
      <ServerForm
        key={server.name}
        onSubmit={handleSubmit}
        onCancel={onCancel}
        initialData={server}
        modalTitle={t('server.editTitle', { serverName: server.name })}
        formError={error}
        onClearFormError={() => setError(null)}
        isSubmitting={isSubmitting}
      />
    </div>
  );
};

export default EditServerForm;
