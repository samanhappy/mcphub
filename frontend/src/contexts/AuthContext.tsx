import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { AuthState } from '../types';
import * as authService from '../services/authService';
import { getPublicConfig } from '../services/configService';

// Initial auth state
const initialState: AuthState = {
  isAuthenticated: false,
  loading: true,
  user: null,
  error: null,
};

// Create auth context
const AuthContext = createContext<{
  auth: AuthState;
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, password: string, isAdmin?: boolean) => Promise<boolean>;
  logout: () => void;
}>({
  auth: initialState,
  login: async () => false,
  register: async () => false,
  logout: () => { },
});

// Auth provider component
export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [auth, setAuth] = useState<AuthState>(initialState);

  // Load user if token exists
  useEffect(() => {
    const loadUser = async () => {
      // First check if authentication should be skipped
      const { skipAuth, permissions } = await getPublicConfig();

      if (skipAuth) {
        // If authentication is disabled, set user as authenticated with a dummy user
        setAuth({
          isAuthenticated: true,
          loading: false,
          user: {
            username: 'guest',
            isAdmin: true,
            permissions,
          },
          error: null,
        });
        return;
      }

      // Normal authentication flow
      const token = authService.getToken();

      if (!token) {
        setAuth({
          ...initialState,
          loading: false,
        });
        return;
      }

      try {
        const response = await authService.getCurrentUser();

        if (response.success && response.user) {
          setAuth({
            isAuthenticated: true,
            loading: false,
            user: response.user,
            error: null,
          });
        } else {
          authService.removeToken();
          setAuth({
            ...initialState,
            loading: false,
          });
        }
      } catch (error) {
        authService.removeToken();
        setAuth({
          ...initialState,
          loading: false,
        });
      }
    };

    loadUser();
  }, []);

  // Login function
  const login = async (username: string, password: string): Promise<boolean> => {
    try {
      const response = await authService.login({ username, password });

      if (response.success && response.token && response.user) {
        setAuth({
          isAuthenticated: true,
          loading: false,
          user: response.user,
          error: null,
        });
        return true;
      } else {
        setAuth({
          ...initialState,
          loading: false,
          error: response.message || 'Authentication failed',
        });
        return false;
      }
    } catch (error) {
      setAuth({
        ...initialState,
        loading: false,
        error: 'Authentication failed',
      });
      return false;
    }
  };

  // Register function
  const register = async (
    username: string,
    password: string,
    isAdmin = false
  ): Promise<boolean> => {
    try {
      const response = await authService.register({ username, password, isAdmin });

      if (response.success && response.token && response.user) {
        setAuth({
          isAuthenticated: true,
          loading: false,
          user: response.user,
          error: null,
        });
        return true;
      } else {
        setAuth({
          ...initialState,
          loading: false,
          error: response.message || 'Registration failed',
        });
        return false;
      }
    } catch (error) {
      setAuth({
        ...initialState,
        loading: false,
        error: 'Registration failed',
      });
      return false;
    }
  };

  // Logout function
  const logout = (): void => {
    authService.logout();
    setAuth({
      ...initialState,
      loading: false,
    });
  };

  return (
    <AuthContext.Provider value={{ auth, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

// Custom hook to use auth context
export const useAuth = () => useContext(AuthContext);