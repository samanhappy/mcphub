import { getApiUrl } from './runtime';

// Define the interceptor interface
export interface FetchInterceptor {
  request?: (url: string, config: RequestInit) => Promise<{ url: string; config: RequestInit }>;
  response?: (response: Response) => Promise<Response>;
  error?: (error: Error) => Promise<Error>;
}

// Define the enhanced fetch response interface
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
}

// Global interceptors store
const interceptors: FetchInterceptor[] = [];

// Add an interceptor
export const addInterceptor = (interceptor: FetchInterceptor): void => {
  interceptors.push(interceptor);
};

// Remove an interceptor
export const removeInterceptor = (interceptor: FetchInterceptor): void => {
  const index = interceptors.indexOf(interceptor);
  if (index > -1) {
    interceptors.splice(index, 1);
  }
};

// Clear all interceptors
export const clearInterceptors = (): void => {
  interceptors.length = 0;
};

// Enhanced fetch function with interceptors
export const fetchWithInterceptors = async (
  input: string | URL | Request,
  init: RequestInit = {},
): Promise<Response> => {
  let url = input.toString();
  let config = { ...init };

  try {
    // Apply request interceptors
    for (const interceptor of interceptors) {
      if (interceptor.request) {
        const result = await interceptor.request(url, config);
        url = result.url;
        config = result.config;
      }
    }

    // Make the actual fetch request
    let response = await fetch(url, config);

    // Apply response interceptors
    for (const interceptor of interceptors) {
      if (interceptor.response) {
        response = await interceptor.response(response);
      }
    }

    return response;
  } catch (error) {
    let processedError = error as Error;

    // Apply error interceptors
    for (const interceptor of interceptors) {
      if (interceptor.error) {
        processedError = await interceptor.error(processedError);
      }
    }

    throw processedError;
  }
};

// Convenience function for API calls with automatic URL construction
export const apiRequest = async <T = any>(endpoint: string, init: RequestInit = {}): Promise<T> => {
  try {
    const url = getApiUrl(endpoint);
    const response = await fetchWithInterceptors(url, init);

    // Try to parse JSON response
    let data: T;
    try {
      data = await response.json();
    } catch (parseError) {
      // If JSON parsing fails, create a generic response
      const genericResponse = {
        success: response.ok,
        message: response.ok
          ? 'Request successful'
          : `HTTP ${response.status}: ${response.statusText}`,
      };
      data = genericResponse as T;
    }

    // If response is not ok, but no explicit error in parsed data
    if (!response.ok && typeof data === 'object' && data !== null) {
      const responseObj = data as any;
      if (responseObj.success !== false) {
        responseObj.success = false;
        responseObj.message =
          responseObj.message || `HTTP ${response.status}: ${response.statusText}`;
      }
    }

    return data;
  } catch (error) {
    console.error('API request error:', error);
    const errorResponse = {
      success: false,
      message: error instanceof Error ? error.message : 'An unknown error occurred',
    };
    return errorResponse as T;
  }
};

// Convenience methods for common HTTP methods
export const apiGet = <T = any>(endpoint: string, init: Omit<RequestInit, 'method'> = {}) =>
  apiRequest<T>(endpoint, { ...init, method: 'GET' });

export const apiPost = <T = any>(
  endpoint: string,
  data?: any,
  init: Omit<RequestInit, 'method' | 'body'> = {},
) =>
  apiRequest<T>(endpoint, {
    ...init,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
    body: data ? JSON.stringify(data) : undefined,
  });

export const apiPut = <T = any>(
  endpoint: string,
  data?: any,
  init: Omit<RequestInit, 'method' | 'body'> = {},
) =>
  apiRequest<T>(endpoint, {
    ...init,
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
    body: data ? JSON.stringify(data) : undefined,
  });

export const apiDelete = <T = any>(endpoint: string, init: Omit<RequestInit, 'method'> = {}) =>
  apiRequest<T>(endpoint, { ...init, method: 'DELETE' });

export const apiPatch = <T = any>(
  endpoint: string,
  data?: any,
  init: Omit<RequestInit, 'method' | 'body'> = {},
) =>
  apiRequest<T>(endpoint, {
    ...init,
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
    body: data ? JSON.stringify(data) : undefined,
  });
