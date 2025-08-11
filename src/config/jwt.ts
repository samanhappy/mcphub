import crypto from 'crypto';

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret) {
  jwtSecret = crypto.randomBytes(32).toString('hex');
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      'Warning: JWT_SECRET is not set. Using a temporary secret. Please set a strong, persistent secret in your environment variables for production.',
    );
  }
}

export const JWT_SECRET = jwtSecret;
