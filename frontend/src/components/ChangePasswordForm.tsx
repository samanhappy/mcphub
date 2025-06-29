import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChangePasswordCredentials } from '../types';
import { changePassword } from '../services/authService';

interface ChangePasswordFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
}

const ChangePasswordForm: React.FC<ChangePasswordFormProps> = ({ onSuccess, onCancel }) => {
  const { t } = useTranslation();
  const [formData, setFormData] = useState<ChangePasswordCredentials>({
    currentPassword: '',
    newPassword: '',
  });
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'confirmPassword') {
      setConfirmPassword(value);
    } else {
      setFormData(prev => ({ ...prev, [name]: value }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate passwords match
    if (formData.newPassword !== confirmPassword) {
      setError(t('auth.passwordsNotMatch'));
      return;
    }

    setIsLoading(true);
    try {
      const response = await changePassword(formData);

      if (response.success) {
        setSuccess(true);
        if (onSuccess) {
          onSuccess();
        }
      } else {
        setError(response.message || t('auth.changePasswordError'));
      }
    } catch (err) {
      setError(t('auth.changePasswordError'));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-xl font-bold mb-4">{t('auth.changePassword')}</h2>

      {success ? (
        <div className="bg-green-100 border border-green-400 text-green-700 px-4 py-3 rounded mb-4">
          {t('auth.changePasswordSuccess')}
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="currentPassword">
              {t('auth.currentPassword')}
            </label>
            <input
              type="password"
              id="currentPassword"
              name="currentPassword"
              className="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 form-input"
              value={formData.currentPassword}
              onChange={handleChange}
              required
            />
          </div>

          <div className="mb-4">
            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="newPassword">
              {t('auth.newPassword')}
            </label>
            <input
              type="password"
              id="newPassword"
              name="newPassword"
              className="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 form-input"
              value={formData.newPassword}
              onChange={handleChange}
              required
              minLength={6}
            />
          </div>

          <div className="mb-6">
            <label className="block text-gray-700 text-sm font-bold mb-2" htmlFor="confirmPassword">
              {t('auth.confirmPassword')}
            </label>
            <input
              type="password"
              id="confirmPassword"
              name="confirmPassword"
              className="w-full p-2 border rounded focus:outline-none focus:ring-2 focus:ring-blue-500 form-input"
              value={confirmPassword}
              onChange={handleChange}
              required
              minLength={6}
            />
          </div>

          <div className="flex justify-end space-x-2">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                disabled={isLoading}
                className="py-2 px-4 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
              >
                {t('common.cancel')}
              </button>
            )}
            <button
              type="submit"
              disabled={isLoading}
              className="py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 btn-primary"
            >
              {isLoading ? (
                <span className="flex items-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  {t('common.save')}
                </span>
              ) : (
                t('common.save')
              )}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default ChangePasswordForm;