import express from 'express';
import { check } from 'express-validator';
import config from '../config/index.js';
import {
  getAllServers,
  getAllSettings,
  createServer,
  updateServer,
  deleteServer,
  toggleServer,
  toggleTool,
  updateToolDescription,
  togglePrompt,
  updatePromptDescription,
  updateSystemConfig,
} from '../controllers/serverController.js';
import {
  getGroups,
  getGroup,
  createNewGroup,
  updateExistingGroup,
  deleteExistingGroup,
  addServerToExistingGroup,
  removeServerFromExistingGroup,
  getGroupServers,
  updateGroupServersBatch,
  getGroupServerConfigs,
  getGroupServerConfig,
  updateGroupServerTools,
} from '../controllers/groupController.js';
import {
  getUsers,
  getUser,
  createUser,
  updateExistingUser,
  deleteExistingUser,
  getUserStats,
} from '../controllers/userController.js';
import {
  getAllMarketServers,
  getMarketServer,
  getAllMarketCategories,
  getAllMarketTags,
  searchMarketServersByQuery,
  getMarketServersByCategory,
  getMarketServersByTag,
} from '../controllers/marketController.js';
import {
  getAllCloudServers,
  getCloudServer,
  getAllCloudCategories,
  getAllCloudTags,
  searchCloudServersByQuery,
  getCloudServersByCategory,
  getCloudServersByTag,
  getCloudServerToolsList,
  callCloudTool,
} from '../controllers/cloudController.js';
import { login, register, getCurrentUser, changePassword } from '../controllers/authController.js';
import { getAllLogs, clearLogs, streamLogs } from '../controllers/logController.js';
import { getRuntimeConfig, getPublicConfig } from '../controllers/configController.js';
import { callTool } from '../controllers/toolController.js';
import { getPrompt } from '../controllers/promptController.js';
import { uploadDxtFile, uploadMiddleware } from '../controllers/dxtController.js';
import { healthCheck } from '../controllers/healthController.js';
import {
  getOpenAPISpec,
  getOpenAPIServers,
  getOpenAPIStats,
  executeToolViaOpenAPI,
  getGroupOpenAPISpec,
} from '../controllers/openApiController.js';
import { auth } from '../middlewares/auth.js';

const router = express.Router();

export const initRoutes = (app: express.Application): void => {
  // Health check endpoint (no auth required, accessible at /health)
  app.get('/health', healthCheck);

  // API routes protected by auth middleware in middlewares/index.ts
  router.get('/servers', getAllServers);
  router.get('/settings', getAllSettings);
  router.post('/servers', createServer);
  router.put('/servers/:name', updateServer);
  router.delete('/servers/:name', deleteServer);
  router.post('/servers/:name/toggle', toggleServer);
  router.post('/servers/:serverName/tools/:toolName/toggle', toggleTool);
  router.put('/servers/:serverName/tools/:toolName/description', updateToolDescription);
  router.post('/servers/:serverName/prompts/:promptName/toggle', togglePrompt);
  router.put('/servers/:serverName/prompts/:promptName/description', updatePromptDescription);
  router.put('/system-config', updateSystemConfig);

  // Group management routes
  router.get('/groups', getGroups);
  router.get('/groups/:id', getGroup);
  router.post('/groups', createNewGroup);
  router.put('/groups/:id', updateExistingGroup);
  router.delete('/groups/:id', deleteExistingGroup);
  router.post('/groups/:id/servers', addServerToExistingGroup);
  router.delete('/groups/:id/servers/:serverName', removeServerFromExistingGroup);
  router.get('/groups/:id/servers', getGroupServers);
  // New route for batch updating servers in a group
  router.put('/groups/:id/servers/batch', updateGroupServersBatch);
  // New routes for server configurations and tool management in groups
  router.get('/groups/:id/server-configs', getGroupServerConfigs);
  router.get('/groups/:id/server-configs/:serverName', getGroupServerConfig);
  router.put('/groups/:id/server-configs/:serverName/tools', updateGroupServerTools);

  // User management routes (admin only)
  router.get('/users', getUsers);
  router.get('/users/:username', getUser);
  router.post('/users', createUser);
  router.put('/users/:username', updateExistingUser);
  router.delete('/users/:username', deleteExistingUser);
  router.get('/users-stats', getUserStats);

  // Tool management routes
  router.post('/tools/call/:server', callTool);

  // Prompt management routes
  router.post('/mcp/:serverName/prompts/:promptName', getPrompt);

  // DXT upload routes
  router.post('/dxt/upload', uploadMiddleware, uploadDxtFile);

  // Market routes
  router.get('/market/servers', getAllMarketServers);
  router.get('/market/servers/search', searchMarketServersByQuery);
  router.get('/market/servers/:name', getMarketServer);
  router.get('/market/categories', getAllMarketCategories);
  router.get('/market/categories/:category', getMarketServersByCategory);
  router.get('/market/tags', getAllMarketTags);
  router.get('/market/tags/:tag', getMarketServersByTag);

  // Cloud Market routes
  router.get('/cloud/servers', getAllCloudServers);
  router.get('/cloud/servers/search', searchCloudServersByQuery);
  router.get('/cloud/servers/:name', getCloudServer);
  router.get('/cloud/categories', getAllCloudCategories);
  router.get('/cloud/categories/:category', getCloudServersByCategory);
  router.get('/cloud/tags', getAllCloudTags);
  router.get('/cloud/tags/:tag', getCloudServersByTag);
  router.get('/cloud/servers/:serverName/tools', getCloudServerToolsList);
  router.post('/cloud/servers/:serverName/tools/:toolName/call', callCloudTool);

  // Log routes
  router.get('/logs', getAllLogs);
  router.delete('/logs', clearLogs);
  router.get('/logs/stream', streamLogs);

  // Auth routes - move to router instead of app directly
  router.post(
    '/auth/login',
    [
      check('username', 'Username is required').not().isEmpty(),
      check('password', 'Password is required').not().isEmpty(),
    ],
    login,
  );

  router.post(
    '/auth/register',
    [
      check('username', 'Username is required').not().isEmpty(),
      check('password', 'Password must be at least 6 characters').isLength({ min: 6 }),
    ],
    register,
  );

  router.get('/auth/user', auth, getCurrentUser);

  // Add change password route
  router.post(
    '/auth/change-password',
    [
      auth,
      check('currentPassword', 'Current password is required').not().isEmpty(),
      check('newPassword', 'New password must be at least 6 characters').isLength({ min: 6 }),
    ],
    changePassword,
  );

  // Runtime configuration endpoint (no auth required for frontend initialization)
  app.get(`${config.basePath}/config`, getRuntimeConfig);

  // Public configuration endpoint (no auth required to check skipAuth setting)
  app.get(`${config.basePath}/public-config`, getPublicConfig);

  // OpenAPI generation endpoints
  app.get(`${config.basePath}/api/openapi.json`, getOpenAPISpec);
  app.get(`${config.basePath}/api/:name/openapi.json`, getGroupOpenAPISpec);
  app.get(`${config.basePath}/api/openapi/servers`, getOpenAPIServers);
  app.get(`${config.basePath}/api/openapi/stats`, getOpenAPIStats);

  // OpenAPI-compatible tool execution endpoints
  app.get(`${config.basePath}/api/tools/:serverName/:toolName`, executeToolViaOpenAPI);
  app.post(`${config.basePath}/api/tools/:serverName/:toolName`, executeToolViaOpenAPI);
  app.get(`${config.basePath}/api/:name/tools/:serverName/:toolName`, executeToolViaOpenAPI);
  app.post(`${config.basePath}/api/:name/tools/:serverName/:toolName`, executeToolViaOpenAPI);

  app.use(`${config.basePath}/api`, router);
};

export default router;
