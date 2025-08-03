import { addInterceptor, removeInterceptor, type FetchInterceptor } from './fetchInterceptor';

// Token key in localStorage
const TOKEN_KEY = 'mcphub_token';

// Get token from localStorage
export const getToken = (): string | null => {
  return localStorage.getItem(TOKEN_KEY);
};

// Set token in localStorage
export const setToken = (token: string): void => {
  localStorage.setItem(TOKEN_KEY, token);
};

// Remove token from localStorage
export const removeToken = (): void => {
  localStorage.removeItem(TOKEN_KEY);
};

// Auth interceptor for automatically adding authorization headers
export const authInterceptor: FetchInterceptor = {
  request: async (url: string, config: RequestInit) => {
    const headers = new Headers(config.headers);
    const language = localStorage.getItem('i18nextLng') || 'en';
    headers.set('Accept-Language', language);

    const token = getToken();
    if (token) {
      headers.set('x-auth-token', token);
    }

    return {
      url,
      config: {
        ...config,
        headers,
      },
    };
  },

  response: async (response: Response) => {
    // Handle unauthorized responses
    if (response.status === 401) {
      // Token might be expired or invalid, remove it
      removeToken();

      // You could also trigger a redirect to login page here
      // window.location.href = '/login';
    }

    return response;
  },

  error: async (error: Error) => {
    console.error('Auth interceptor error:', error);
    return error;
  },
};

// Install the auth interceptor
export const installAuthInterceptor = (): void => {
  addInterceptor(authInterceptor);
};

// Uninstall the auth interceptor
export const uninstallAuthInterceptor = (): void => {
  removeInterceptor(authInterceptor);
};

// Logging interceptor for development
export const loggingInterceptor: FetchInterceptor = {
  request: async (url: string, config: RequestInit) => {
    console.log(`🚀 [${config.method || 'GET'}] ${url}`, config);
    return { url, config };
  },

  response: async (response: Response) => {
    console.log(`✅ [${response.status}] ${response.url}`);
    return response;
  },

  error: async (error: Error) => {
    console.error(`❌ Fetch error:`, error);
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
