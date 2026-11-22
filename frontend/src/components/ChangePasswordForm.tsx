import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Loader2 } from 'lucide-react';
import { ChangePasswordCredentials } from '../types';
import { changePassword } from '../services/authService';
import { validatePasswordStrength } from '../utils/passwordValidation';

interface ChangePasswordFormProps {
  onSuccess?: () => void;
  onCancel?: () => void;
  embedded?: boolean;
}

const ChangePasswordForm: React.FC<ChangePasswordFormProps> = ({
  onSuccess,
  onCancel,
  embedded = false,
}) => {
  const { t } = useTranslation();
  const [formData, setFormData] = useState<ChangePasswordCredentials>({
    currentPassword: '',
    newPassword: '',
  });
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<string[]>([]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'confirmPassword') {
      setConfirmPassword(value);
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));

      // Validate password strength on change for new password
      if (name === 'newPassword') {
        const validation = validatePasswordStrength(value);
        setPasswordErrors(validation.errors);
      }
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate password strength
    const validation = validatePasswordStrength(formData.newPassword);
    if (!validation.isValid) {
      setError(t('auth.passwordStrengthError'));
      setPasswordErrors(validation.errors);
      return;
    }

    setPasswordErrors([]);

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
    } catch {
      setError(t('auth.changePasswordError'));
    } finally {
      setIsLoading(false);
    }
  };

  const content = (
    <>
      {!embedded && (
        <h2 className="mb-4 text-lg font-semibold text-[var(--hub-ink)]">
          {t('auth.changePassword')}
        </h2>
      )}

      {success ? (
        <div
          role="status"
          className="rounded-lg border border-emerald-300/70 bg-emerald-50 px-3.5 py-2.5 text-sm text-emerald-800 dark:border-emerald-800/60 dark:bg-emerald-950/50 dark:text-emerald-200"
        >
          {t('auth.changePasswordSuccess')}
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div
              role="alert"
              className="rounded-lg border border-red-300/70 bg-red-50 px-3.5 py-2.5 text-xs text-red-800 dark:border-red-800/60 dark:bg-red-950/50 dark:text-red-200"
            >
              <p className="font-medium">{error}</p>
              {passwordErrors.length > 0 && (
                <ul className="mt-1.5 list-inside list-disc space-y-0.5">
                  {passwordErrors.map((errorKey) => (
                    <li key={errorKey}>{t(`auth.${errorKey}`)}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div>
            <label
              className="mb-1.5 block text-xs font-medium text-[var(--hub-ink)]"
              htmlFor="currentPassword"
            >
              {t('auth.currentPassword')}
            </label>
            <input
              type="password"
              id="currentPassword"
              name="currentPassword"
              autoComplete="current-password"
              className="hub-input"
              value={formData.currentPassword}
              onChange={handleChange}
              required
              disabled={isLoading}
            />
          </div>

          <div>
            <label
              className="mb-1.5 block text-xs font-medium text-[var(--hub-ink)]"
              htmlFor="newPassword"
            >
              {t('auth.newPassword')}
            </label>
            <input
              type="password"
              id="newPassword"
              name="newPassword"
              autoComplete="new-password"
              className="hub-input"
              value={formData.newPassword}
              onChange={handleChange}
              required
              minLength={8}
              disabled={isLoading}
            />
            {/* Password strength hints */}
            {formData.newPassword && passwordErrors.length > 0 && (
              <div className="mt-2 rounded-md border border-[var(--hub-line)] bg-[var(--hub-bg-2)] p-2.5 text-xs text-[var(--hub-ink-2)]">
                <p className="mb-1 font-medium">{t('auth.passwordStrengthHint')}</p>
                <ul className="list-inside list-disc space-y-0.5">
                  {passwordErrors.map((errorKey) => (
                    <li key={errorKey} className="text-[var(--hub-err)]">
                      {t(`auth.${errorKey}`)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {formData.newPassword && passwordErrors.length === 0 && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-[var(--hub-ok)]">
                <Check size={13} aria-hidden="true" />
                <span>{t('auth.passwordStrengthHint')}</span>
              </p>
            )}
          </div>

          <div>
            <label
              className="mb-1.5 block text-xs font-medium text-[var(--hub-ink)]"
              htmlFor="confirmPassword"
            >
              {t('auth.confirmPassword')}
            </label>
            <input
              type="password"
              id="confirmPassword"
              name="confirmPassword"
              autoComplete="new-password"
              className="hub-input"
              value={confirmPassword}
              onChange={handleChange}
              required
              minLength={8}
              disabled={isLoading}
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            {onCancel && (
              <button type="button" onClick={onCancel} disabled={isLoading} className="hub-btn">
                {t('common.cancel')}
              </button>
            )}
            <button type="submit" disabled={isLoading} className="hub-btn primary">
              {isLoading && <Loader2 size={14} className="animate-spin" aria-hidden="true" />}
              <span>{t('common.save')}</span>
            </button>
          </div>
        </form>
      )}
    </>
  );

  if (embedded) {
    return <div className="max-w-lg">{content}</div>;
  }

  return <div className="hub-card p-5">{content}</div>;
};

export default ChangePasswordForm;
