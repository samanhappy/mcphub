// Test utilities and helpers
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

export interface TestUser {
  username: string;
  password: string;
  isAdmin?: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
}

/**
 * Create a test Express app instance
 */
export const createTestApp = (): express.Application => {
  const app = express();
  app.use(express.json());
  return app;
};

/**
 * Generate a test JWT token
 */
export const generateTestToken = (payload: any, secret = 'test-jwt-secret-key'): string => {
  return jwt.sign(payload, secret, { expiresIn: '1h' });
};

/**
 * Create a test user token with default claims
 */
export const createUserToken = (username = 'testuser', isAdmin = false): string => {
  const payload = {
    user: {
      username,
      isAdmin,
    },
  };
  return generateTestToken(payload);
};

/**
 * Create an admin user token
 */
export const createAdminToken = (username = 'admin'): string => {
  return createUserToken(username, true);
};

/**
 * Make authenticated request helper
 */
export const makeAuthenticatedRequest = (app: express.Application, token: string) => {
  return {
    get: (url: string) => request(app).get(url).set('Authorization', `Bearer ${token}`),
    post: (url: string) => request(app).post(url).set('Authorization', `Bearer ${token}`),
    put: (url: string) => request(app).put(url).set('Authorization', `Bearer ${token}`),
    delete: (url: string) => request(app).delete(url).set('Authorization', `Bearer ${token}`),
    patch: (url: string) => request(app).patch(url).set('Authorization', `Bearer ${token}`),
  };
};

/**
 * Common test data generators
 */
export const TestData = {
  user: (overrides: Partial<TestUser> = {}): TestUser => ({
    username: 'testuser',
    password: 'password123',
    isAdmin: false,
    ...overrides,
  }),

  adminUser: (overrides: Partial<TestUser> = {}): TestUser => ({
    username: 'admin',
    password: 'admin123',
    isAdmin: true,
    ...overrides,
  }),

  serverConfig: (overrides: any = {}) => ({
    type: 'openapi',
    openapi: {
      url: 'https://api.example.com/openapi.json',
      version: '3.1.0',
      security: {
        type: 'none',
      },
    },
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    ...overrides,
  }),
};

/**
 * Mock response helpers
 */
export const MockResponse = {
  success: (data: any = {}) => ({
    success: true,
    data,
  }),

  error: (message: string, code = 400) => ({
    success: false,
    message,
    code,
  }),

  validation: (errors: any[]) => ({
    success: false,
    errors,
  }),
};

/**
 * Database test helpers
 */
export const DbHelpers = {
  /**
   * Clear all test data from database
   */
  clearDatabase: async (): Promise<void> => {
    // TODO: Implement based on your database setup
    console.log('Clearing test database...');
  },

  /**
   * Seed test data
   */
  seedTestData: async (): Promise<void> => {
    // TODO: Implement based on your database setup
    console.log('Seeding test data...');
  },
};

/**
 * Wait for async operations to complete
 */
export const waitFor = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Assert API response structure
 */
export const expectApiResponse = (response: any) => ({
  toBeSuccess: (expectedData?: any) => {
    expect(response.body).toHaveProperty('success', true);
    if (expectedData) {
      expect(response.body.data).toEqual(expectedData);
    }
  },

  toBeError: (expectedMessage?: string, expectedCode?: number) => {
    expect(response.body).toHaveProperty('success', false);
    if (expectedMessage) {
      expect(response.body.message).toContain(expectedMessage);
    }
    if (expectedCode) {
      expect(response.status).toBe(expectedCode);
    }
  },

  toHaveValidationErrors: () => {
    expect(response.body).toHaveProperty('success', false);
    expect(response.body).toHaveProperty('errors');
    expect(Array.isArray(response.body.errors)).toBe(true);
  },
});
