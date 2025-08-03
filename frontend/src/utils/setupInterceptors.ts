import { installAuthInterceptor, installLoggingInterceptor } from './interceptors';

/**
 * Setup all default interceptors for the application
 * This should be called once when the app initializes
 */
export const setupInterceptors = (): void => {
  // Install auth interceptor for automatic token handling
  installAuthInterceptor();

  // Install logging interceptor in development mode
  installLoggingInterceptor();
};

/**
 * Initialize interceptors automatically when this module is imported
 * This ensures interceptors are set up as early as possible
 */
setupInterceptors();
