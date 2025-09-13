import express from 'express';
import request from 'supertest';
import { createUserToken } from '../utils/testHelpers.js';
import { auth } from '../../src/middlewares/auth.js';
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

describe('OpenAPI Authorization Integration', () => {
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

    // Simulate OpenAPI tool execution endpoint (from routes/index.ts lines 197-198)
    app.get('/mcp/api/tools/:serverName/:toolName', auth, (req, res) => {
      const { serverName, toolName } = req.params;
      res.json({ 
        success: true, 
        result: `Tool ${toolName} executed on server ${serverName}`,
        user: (req as any).user 
      });
    });

    app.post('/mcp/api/tools/:serverName/:toolName', auth, (req, res) => {
      const { serverName, toolName } = req.params;
      res.json({ 
        success: true, 
        result: `Tool ${toolName} executed on server ${serverName} with args`,
        args: req.body,
        user: (req as any).user 
      });
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

  describe('Issue #336 - OpenAPI Authentication with Authorization Header', () => {
    const validToken = createUserToken('testuser', false);

    it('should accept standard Authorization Bearer header for GET tool execution', async () => {
      const response = await request(app)
        .get('/mcp/api/tools/time/time-get_current_time')
        .set('Authorization', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.result).toBe('Tool time-get_current_time executed on server time');
      expect(response.body.user).toEqual({
        username: 'testuser',
        isAdmin: false,
      });
    });

    it('should accept standard Authorization Bearer header for POST tool execution', async () => {
      const response = await request(app)
        .post('/mcp/api/tools/time/time-get_current_time')
        .set('Authorization', `Bearer ${validToken}`)
        .send({ timezone: 'UTC' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.result).toBe('Tool time-get_current_time executed on server time with args');
      expect(response.body.args).toEqual({ timezone: 'UTC' });
      expect(response.body.user).toEqual({
        username: 'testuser',
        isAdmin: false,
      });
    });

    it('should still work with x-auth-token header (backward compatibility)', async () => {
      const response = await request(app)
        .get('/mcp/api/tools/time/time-get_current_time')
        .set('x-auth-token', `Bearer ${validToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user).toEqual({
        username: 'testuser',
        isAdmin: false,
      });
    });

    it('should still work with x-auth-token header without Bearer prefix', async () => {
      const response = await request(app)
        .get('/mcp/api/tools/time/time-get_current_time')
        .set('x-auth-token', validToken);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user).toEqual({
        username: 'testuser',
        isAdmin: false,
      });
    });

    it('should deny access without any authentication header', async () => {
      const response = await request(app)
        .get('/mcp/api/tools/time/time-get_current_time');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('No token, authorization denied');
    });

    it('should deny access with invalid Authorization header format', async () => {
      const response = await request(app)
        .get('/mcp/api/tools/time/time-get_current_time')
        .set('Authorization', 'Basic invalidtoken');

      expect(response.status).toBe(401);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('No token, authorization denied');
    });
  });

  describe('Bearer Auth Priority (Custom API Key)', () => {
    const jwtToken = createUserToken('testuser', false);

    it('should prioritize custom bearer auth over JWT when configured', async () => {
      mockLoadSettings.mockReturnValue({
        systemConfig: {
          routing: {
            enableGlobalRoute: true,
            enableGroupNameRoute: true,
            enableBearerAuth: true,
            bearerAuthKey: 'my-custom-api-key',
            skipAuth: false,
          },
        },
        servers: [],
        groups: [],
        users: [],
      });

      const response = await request(app)
        .get('/mcp/api/tools/time/time-get_current_time')
        .set('Authorization', 'Bearer my-custom-api-key');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should fallback to JWT auth when bearer key does not match', async () => {
      mockLoadSettings.mockReturnValue({
        systemConfig: {
          routing: {
            enableGlobalRoute: true,
            enableGroupNameRoute: true,
            enableBearerAuth: true,
            bearerAuthKey: 'my-custom-api-key',
            skipAuth: false,
          },
        },
        servers: [],
        groups: [],
        users: [],
      });

      const response = await request(app)
        .get('/mcp/api/tools/time/time-get_current_time')
        .set('Authorization', `Bearer ${jwtToken}`);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.user).toEqual({
        username: 'testuser',
        isAdmin: false,
      });
    });
  });
});