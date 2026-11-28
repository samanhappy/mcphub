import { addInterceptor, removeInterceptor, type FetchInterceptor } from './fetchInterceptor';

// Dashboard API requests use the browser session cookie.
export const authInterceptor: FetchInterceptor = {
  request: async (url: string, config: RequestInit) => {
    const headers = new Headers(config.headers);
    const language = localStorage.getItem('i18nextLng') || 'en';
    headers.set('Accept-Language', language);

    return {
      url,
      config: {
        ...config,
        headers,
        credentials: config.credentials ?? 'include',
      },
    };
  },

  error: async (error: Error) => {
    console.error('Auth interceptor error:', error);
    return error;
  },
};

// Install the auth interceptor
export const installAuthInterceptor = (): void => {
  localStorage.removeItem('mcphub_token');
  addInterceptor(authInterceptor);
};

// Uninstall the auth interceptor
export const uninstallAuthInterceptor = (): void => {
  removeInterceptor(authInterceptor);
};

// Logging interceptor for development
export const loggingInterceptor: FetchInterceptor = {
  request: async (url: string, config: RequestInit) => {
    console.log('🚀 Request', { method: config.method || 'GET', url, config });
    return { url, config };
  },

  response: async (response: Response) => {
    console.log(`✅ [${response.status}] ${response.url}`);
    return response;
  },

  error: async (error: Error) => {
    console.error('❌ Fetch error', { error });
    return error;
  },
};

// Install the logging interceptor (only in development)
export const installLoggingInterceptor = (): void => {
  if (process.env.NODE_ENV === 'development') {
    addInterceptor(loggingInterceptor);
  }
};

// Uninstall the logging interceptor
export const uninstallLoggingInterceptor = (): void => {
  removeInterceptor(loggingInterceptor);
};
