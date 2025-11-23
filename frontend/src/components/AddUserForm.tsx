import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUserData } from '@/hooks/useUserData';
import { UserFormData } from '@/types';

interface AddUserFormProps {
  onAdd: () => void;
  onCancel: () => void;
}

const AddUserForm = ({ onAdd, onCancel }: AddUserFormProps) => {
  const { t } = useTranslation();
  const { createUser } = useUserData();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState<UserFormData>({
    username: '',
    password: '',
    isAdmin: false,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.username.trim()) {
      setError(t('users.usernameRequired'));
      return;
    }

    if (!formData.password.trim()) {
      setError(t('users.passwordRequired'));
      return;
    }

    if (formData.password.length < 6) {
      setError(t('users.passwordTooShort'));
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await createUser(formData);
      if (result?.success) {
        onAdd();
      } else {
        setError(result?.message || t('users.createError'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('users.createError'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value, type, checked } = e.target;
    setFormData((prev) => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white p-8 rounded-xl shadow-2xl max-w-md w-full mx-4 border border-gray-100">
        <form onSubmit={handleSubmit}>
          <h2 className="text-xl font-bold text-gray-900 mb-6">{t('users.addNew')}</h2>

          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded-md">
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          <div className="space-y-5">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
                {t('users.username')} <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="username"
                name="username"
                value={formData.username}
                onChange={handleInputChange}
                placeholder={t('users.usernamePlaceholder')}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent form-input transition-all duration-200"
                required
                disabled={isSubmitting}
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                {t('users.password')} <span className="text-red-500">*</span>
              </label>
              <input
                type="password"
                id="password"
                name="password"
                value={formData.password}
                onChange={handleInputChange}
                placeholder={t('users.passwordPlaceholder')}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent form-input transition-all duration-200"
                required
                disabled={isSubmitting}
                minLength={6}
              />
            </div>

            <div className="flex items-center pt-2">
              <input
                type="checkbox"
                id="isAdmin"
                name="isAdmin"
                checked={formData.isAdmin}
                onChange={handleInputChange}
                className="h-5 w-5 text-blue-600 focus:ring-blue-500 border-gray-300 rounded transition-colors duration-200"
                disabled={isSubmitting}
              />
              <label
                htmlFor="isAdmin"
                className="ml-3 block text-sm font-medium text-gray-700 cursor-pointer select-none"
              >
                {t('users.adminRole')}
              </label>
            </div>
          </div>

          <div className="flex justify-end space-x-3 mt-8">
            <button
              type="button"
              onClick={onCancel}
              className="px-5 py-2.5 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-all duration-200 font-medium btn-secondary shadow-sm"
              disabled={isSubmitting}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all duration-200 font-medium btn-primary shadow-md disabled:opacity-70 disabled:cursor-not-allowed flex items-center"
              disabled={isSubmitting}
            >
              {isSubmitting && (
                <svg
                  className="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  ></circle>
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  ></path>
                </svg>
              )}
              {isSubmitting ? t('common.creating') : t('users.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddUserForm;
