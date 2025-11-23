import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUserData } from '@/hooks/useUserData';
import { User, UserUpdateData } from '@/types';

interface EditUserFormProps {
  user: User;
  onEdit: () => void;
  onCancel: () => void;
}

const EditUserForm = ({ user, onEdit, onCancel }: EditUserFormProps) => {
  const { t } = useTranslation();
  const { updateUser } = useUserData();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [formData, setFormData] = useState({
    isAdmin: user.isAdmin,
    newPassword: '',
    confirmPassword: '',
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate passwords match if changing password
    if (formData.newPassword && formData.newPassword !== formData.confirmPassword) {
      setError(t('users.passwordMismatch'));
      return;
    }

    if (formData.newPassword && formData.newPassword.length < 6) {
      setError(t('users.passwordTooShort'));
      return;
    }

    setIsSubmitting(true);

    try {
      const updateData: UserUpdateData = {
        isAdmin: formData.isAdmin,
      };

      if (formData.newPassword) {
        updateData.newPassword = formData.newPassword;
      }

      const result = await updateUser(user.username, updateData);
      if (result?.success) {
        onEdit();
      } else {
        setError(result?.message || t('users.updateError'));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t('users.updateError'));
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
          <h2 className="text-xl font-bold text-gray-900 mb-6">
            {t('users.edit')} - <span className="text-blue-600">{user.username}</span>
          </h2>

          {error && (
            <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 mb-6 rounded-md">
              <p className="text-sm font-medium">{error}</p>
            </div>
          )}

          <div className="space-y-5">
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

            <div className="border-t border-gray-100 pt-4 mt-2">
              <p className="text-xs text-gray-500 uppercase font-semibold tracking-wider mb-3">
                {t('users.changePassword')}
              </p>

              <div className="space-y-4">
                <div>
                  <label
                    htmlFor="newPassword"
                    className="block text-sm font-medium text-gray-700 mb-1"
                  >
                    {t('users.newPassword')}
                  </label>
                  <input
                    type="password"
                    id="newPassword"
                    name="newPassword"
                    value={formData.newPassword}
                    onChange={handleInputChange}
                    placeholder={t('users.newPasswordPlaceholder')}
                    className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent form-input transition-all duration-200"
                    disabled={isSubmitting}
                    minLength={6}
                  />
                </div>

                {formData.newPassword && (
                  <div className="animate-fadeIn">
                    <label
                      htmlFor="confirmPassword"
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      {t('users.confirmPassword')}
                    </label>
                    <input
                      type="password"
                      id="confirmPassword"
                      name="confirmPassword"
                      value={formData.confirmPassword}
                      onChange={handleInputChange}
                      placeholder={t('users.confirmPasswordPlaceholder')}
                      className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent form-input transition-all duration-200"
                      disabled={isSubmitting}
                      minLength={6}
                    />
                  </div>
                )}
              </div>
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
              {isSubmitting ? t('common.updating') : t('users.update')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EditUserForm;
