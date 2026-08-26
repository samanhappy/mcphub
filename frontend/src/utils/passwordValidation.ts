/**
 * Frontend password strength validation utility
 * Should match backend validation rules
 */

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
}

export const validatePasswordStrength = (password: string): PasswordValidationResult => {
  const errors: string[] = [];

  // Check minimum length
  if (password.length < 8) {
    errors.push('passwordMinLength');
  }

  // Check for at least one letter
  if (!/[a-zA-Z]/.test(password)) {
    errors.push('passwordRequireLetter');
  }

  // Check for at least one number
  if (!/\d/.test(password)) {
    errors.push('passwordRequireNumber');
  }

  // Check for at least one special character
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    errors.push('passwordRequireSpecial');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
};

// Maps backend validation error messages (English) to i18n keys.
// Unknown messages are passed through unchanged so they can still be displayed.
const backendErrorKeyMap: Record<string, string> = {
  'Password must be at least 8 characters long': 'auth.passwordMinLength',
  'Password must contain at least one letter': 'auth.passwordRequireLetter',
  'Password must contain at least one number': 'auth.passwordRequireNumber',
  'Password must contain at least one special character': 'auth.passwordRequireSpecial',
};

export const mapBackendPasswordErrors = (errors: string[]): string[] =>
  errors.map((error) => backendErrorKeyMap[error] ?? error);
