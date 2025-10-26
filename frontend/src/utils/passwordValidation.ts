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
