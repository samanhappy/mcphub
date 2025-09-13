import express from 'express';
import request from 'supertest';
import { auth } from '../../src/middlewares/auth.js';
import { createUserToken } from '../utils/testHelpers.js';
import { loadSettings } from '../../src/config/index.js';

// Mock the config module
jest.mock('../../src/config/index.js', () => ({
  loadSettings: jest.fn(),
  __esModule: true,
  default: {
    readonly: false,
    basePath: '/mcp',
  },
}));

// Mock the JWT_SECRET
jest.mock('../../src/config/jwt.js', () => ({
  JWT_SECRET: 'test-jwt-secret-key',
}));

// Mock i18n function
const mockT = jest.fn((key: string) => key);

describe('Auth Middleware', () => {
  let app: express.Application;
  const mockLoadSettings = loadSettings as jest.MockedFunction<typeof loadSettings>;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    
    // Mock i18n middleware
    app.use((req, _res, next) => {
      (req as any).t = mockT;
      next();
    });

    // Add a test route that uses auth middleware
    app.get('/test/protected', auth, (req, res) => {
      res.json({ success: true, user: (req as any).user });
    });

    // Mock default settings
    mockLoadSettings.mockReturnValue({
      systemConfig: {
        routing: {
          enableGlobalRoute: true,
          enableGroupNameRoute: true,
          enableBearerAuth: false,
          bearerAuthKey: '',
          skipAuth: false,
        },
      },
      servers: [],
      groups: [],
      users: [],
    });

    jest.clearAllMocks();
  });

  describe('Authorization Header Support', () => {
    const validToken = createUserToken('testuser', false);

    it('should accept token via x-auth-token header (current working method)', async () => {
      const response = await request(app)
        .get('/test/protected')
        .set('x-auth-token', validToken);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user).toEqual({
        username: 'testuser',
        isAdmin: false,
      });
    });

    it('should accept token via x-auth-token header with Bearer prefix', async () => {
      const response = await request(app)
        .get('/test/protected')
        .set('x-auth-token', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user).toEqual({
        username: 'testuser',
        isAdmin: false,
      });
    });

    it('should accept token via query parameter', async () => {
      const response = await request(app)
        .get('/test/protected')
        .query({ token: validToken });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user).toEqual({
        username: 'testuser',
        isAdmin: false,
      });
    });

    it('should accept standard Authorization Bearer header (bug fixed)', async () => {
      const response = await request(app)
        .get('/test/protected')
        .set('Authorization', `Bearer ${validToken}`);

      // This should now work with the fix
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user).toEqual({
        username: 'testuser',
        isAdmin: false,
      });
    });

    it('should FAIL with Authorization header without Bearer prefix', async () => {
      const response = await request(app)
        .get('/test/protected')
        .set('Authorization', validToken);

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('No token, authorization denied');
    });
  });

  describe('Bearer Auth Configuration', () => {
    const validToken = createUserToken('testuser', false);

    it('should accept custom bearer auth when enabled', async () => {
      mockLoadSettings.mockReturnValue({
        systemConfig: {
          routing: {
            enableGlobalRoute: true,
            enableGroupNameRoute: true,
            enableBearerAuth: true,
            bearerAuthKey: 'custom-api-key',
            skipAuth: false,
          },
        },
        servers: [],
        groups: [],
        users: [],
      });

      const response = await request(app)
        .get('/test/protected')
        .set('Authorization', 'Bearer custom-api-key');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should fallback to JWT auth when bearer auth key does not match', async () => {
      mockLoadSettings.mockReturnValue({
        systemConfig: {
          routing: {
            enableGlobalRoute: true,
            enableGroupNameRoute: true,
            enableBearerAuth: true,
            bearerAuthKey: 'custom-api-key',
            skipAuth: false,
          },
        },
        servers: [],
        groups: [],
        users: [],
      });

      const response = await request(app)
        .get('/test/protected')
        .set('Authorization', `Bearer ${validToken}`);

      // Should fallback to JWT validation and now succeed with the fix
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user).toEqual({
        username: 'testuser',
        isAdmin: false,
      });
    });
  });

  describe('No Authentication Cases', () => {
    it('should deny access when no token provided', async () => {
      const response = await request(app).get('/test/protected');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('No token, authorization denied');
    });

    it('should allow access when auth is skipped', async () => {
      mockLoadSettings.mockReturnValue({
        systemConfig: {
          routing: {
            enableGlobalRoute: true,
            enableGroupNameRoute: true,
            enableBearerAuth: false,
            bearerAuthKey: '',
            skipAuth: true,
          },
        },
        servers: [],
        groups: [],
        users: [],
      });

      const response = await request(app).get('/test/protected');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  describe('Invalid Token Cases', () => {
    it('should reject invalid JWT token', async () => {
      const response = await request(app)
        .get('/test/protected')
        .set('x-auth-token', 'invalid.jwt.token');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Token is not valid');
    });
  });
});