import express from 'express';
import { jest } from '@jest/globals';

const routeHandler = jest.fn();
const uploadMiddleware = jest.fn();
const authMiddleware = jest.fn((_req, _res, next) => next());

jest.mock('../../src/controllers/serverController.js', () => ({
  getAllServers: routeHandler,
  getAllSettings: routeHandler,
  getServerConfig: routeHandler,
  createServer: routeHandler,
  batchCreateServers: routeHandler,
  updateServer: routeHandler,
  deleteServer: routeHandler,
  toggleServer: routeHandler,
  reloadServer: routeHandler,
  toggleTool: routeHandler,
  updateToolDescription: routeHandler,
  resetToolDescription: routeHandler,
  togglePrompt: routeHandler,
  updatePromptDescription: routeHandler,
  resetPromptDescription: routeHandler,
  toggleResource: routeHandler,
  updateResourceDescription: routeHandler,
  resetResourceDescription: routeHandler,
  updateSystemConfig: routeHandler,
}));

jest.mock('../../src/controllers/groupController.js', () => ({
  getGroups: routeHandler,
  getGroup: routeHandler,
  createNewGroup: routeHandler,
  batchCreateGroups: routeHandler,
  updateExistingGroup: routeHandler,
  deleteExistingGroup: routeHandler,
  addServerToExistingGroup: routeHandler,
  removeServerFromExistingGroup: routeHandler,
  getGroupServers: routeHandler,
  updateGroupServersBatch: routeHandler,
  getGroupServerConfigs: routeHandler,
  getGroupServerConfig: routeHandler,
  updateGroupServerTools: routeHandler,
}));

jest.mock('../../src/controllers/userController.js', () => ({
  getUsers: routeHandler,
  getUser: routeHandler,
  createUser: routeHandler,
  updateExistingUser: routeHandler,
  deleteExistingUser: routeHandler,
  getUserStats: routeHandler,
}));

jest.mock('../../src/controllers/marketController.js', () => ({
  getAllMarketServers: routeHandler,
  getMarketServer: routeHandler,
  getAllMarketCategories: routeHandler,
  getAllMarketTags: routeHandler,
  searchMarketServersByQuery: routeHandler,
  getMarketServersByCategory: routeHandler,
  getMarketServersByTag: routeHandler,
}));

jest.mock('../../src/controllers/cloudController.js', () => ({
  getAllCloudServers: routeHandler,
  getCloudServer: routeHandler,
  getAllCloudCategories: routeHandler,
  getAllCloudTags: routeHandler,
  searchCloudServersByQuery: routeHandler,
  getCloudServersByCategory: routeHandler,
  getCloudServersByTag: routeHandler,
  getCloudServerToolsList: routeHandler,
  callCloudTool: routeHandler,
}));

jest.mock('../../src/controllers/registryController.js', () => ({
  getAllRegistryServers: routeHandler,
  getRegistryServerVersions: routeHandler,
  getRegistryServerVersion: routeHandler,
}));

jest.mock('../../src/controllers/authController.js', () => ({
  login: routeHandler,
  register: routeHandler,
  getCurrentUser: routeHandler,
  changePassword: routeHandler,
}));

jest.mock('../../src/controllers/logController.js', () => ({
  getAllLogs: routeHandler,
  clearLogs: routeHandler,
  streamLogs: routeHandler,
}));

jest.mock('../../src/controllers/configController.js', () => ({
  getRuntimeConfig: routeHandler,
  getPublicConfig: routeHandler,
  getMcpSettingsJson: routeHandler,
}));

jest.mock('../../src/controllers/toolController.js', () => ({
  callTool: routeHandler,
}));

jest.mock('../../src/controllers/promptController.js', () => ({
  getPrompt: routeHandler,
}));

jest.mock('../../src/controllers/builtinPromptController.js', () => ({
  listBuiltinPrompts: routeHandler,
  getBuiltinPrompt: routeHandler,
  createBuiltinPrompt: routeHandler,
  updateBuiltinPrompt: routeHandler,
  deleteBuiltinPrompt: routeHandler,
}));

jest.mock('../../src/controllers/builtinResourceController.js', () => ({
  listBuiltinResources: routeHandler,
  getBuiltinResource: routeHandler,
  createBuiltinResource: routeHandler,
  updateBuiltinResource: routeHandler,
  deleteBuiltinResource: routeHandler,
  readResource: routeHandler,
}));

jest.mock('../../src/controllers/mcpbController.js', () => ({
  uploadMcpbFile: routeHandler,
  uploadMiddleware,
}));

jest.mock('../../src/controllers/healthController.js', () => ({
  healthCheck: routeHandler,
}));

jest.mock('../../src/controllers/betterAuthController.js', () => ({
  getBetterAuthUser: routeHandler,
}));

jest.mock('../../src/controllers/openApiController.js', () => ({
  getOpenAPISpec: routeHandler,
  getOpenAPIServers: routeHandler,
  getOpenAPIStats: routeHandler,
  executeToolViaOpenAPI: routeHandler,
  getGroupOpenAPISpec: routeHandler,
}));

jest.mock('../../src/controllers/oauthCallbackController.js', () => ({
  handleOAuthCallback: routeHandler,
}));

jest.mock('../../src/controllers/oauthServerController.js', () => ({
  getAuthorize: routeHandler,
  postAuthorize: routeHandler,
  postToken: routeHandler,
  getUserInfo: routeHandler,
  getMetadata: routeHandler,
  getProtectedResourceMetadata: routeHandler,
}));

jest.mock('../../src/controllers/oauthClientController.js', () => ({
  getAllClients: routeHandler,
  getClient: routeHandler,
  createClient: routeHandler,
  updateClient: routeHandler,
  deleteClient: routeHandler,
  regenerateSecret: routeHandler,
}));

jest.mock('../../src/controllers/oauthDynamicRegistrationController.js', () => ({
  registerClient: routeHandler,
  getClientConfiguration: routeHandler,
  updateClientConfiguration: routeHandler,
  deleteClientRegistration: routeHandler,
}));

jest.mock('../../src/controllers/bearerKeyController.js', () => ({
  getBearerKeys: routeHandler,
  createBearerKey: routeHandler,
  updateBearerKey: routeHandler,
  deleteBearerKey: routeHandler,
}));

jest.mock('../../src/controllers/activityController.js', () => ({
  checkActivityAvailable: routeHandler,
  getActivities: routeHandler,
  getActivityById: routeHandler,
  getActivityStats: routeHandler,
  getActivityFilterOptions: routeHandler,
  deleteOldActivities: routeHandler,
}));

jest.mock('../../src/controllers/templateController.js', () => ({
  exportConfigTemplate: routeHandler,
  exportGroupAsTemplate: routeHandler,
  importConfigTemplate: routeHandler,
}));

jest.mock('../../src/middlewares/auth.js', () => ({
  auth: authMiddleware,
}));

jest.mock('../../src/services/betterAuthConfig.js', () => ({
  getBetterAuthRuntimeConfig: () => ({ enabled: false, basePath: '/better-auth' }),
}));

import { authenticatedRouteRateLimiter } from '../../src/utils/rateLimit.js';
import { initRoutes } from '../../src/routes/index.js';

type ExpressLayer = {
  handle?: ExpressLayerHandle;
  name?: string;
  route?: {
    path: string;
    methods: Record<string, boolean>;
  };
};

type ExpressLayerHandle = {
  stack?: ExpressLayer[];
};

const findMountedRouter = (app: express.Application): ExpressLayerHandle => {
  const appRouter = (app as express.Application & { _router?: { stack?: ExpressLayer[] } })._router;
  const routerLayer = appRouter?.stack?.find((layer) => layer.name === 'router' && layer.handle?.stack);

  if (!routerLayer?.handle?.stack) {
    throw new Error('Expected initRoutes to mount an API router');
  }

  return routerLayer.handle;
};

const routerContainsRoute = (
  routerHandle: ExpressLayerHandle,
  method: string,
  path: string,
): boolean =>
  routerHandle.stack?.some(
    (layer) => layer.route?.path === path && Boolean(layer.route.methods[method.toLowerCase()]),
  ) ?? false;

describe('initRoutes authenticated API rate limiting', () => {
  it('mounts sensitive API routes behind the authenticated rate limiter', async () => {
    const app = express();

    await initRoutes(app);

    const apiRouter = findMountedRouter(app);
    const protectedRouter = apiRouter.stack?.find(
      (layer) => layer.name === 'router' && layer.handle?.stack,
    )?.handle;

    expect(protectedRouter).toBeDefined();
    const authenticatedLimiterIndex =
      protectedRouter?.stack?.findIndex((layer) => layer.handle === authenticatedRouteRateLimiter) ?? -1;

    expect(authenticatedLimiterIndex).toBeGreaterThanOrEqual(0);
    expect(routerContainsRoute(protectedRouter!, 'get', '/servers/:name')).toBe(true);
    expect(routerContainsRoute(protectedRouter!, 'put', '/oauth/clients/:clientId')).toBe(true);
    expect(routerContainsRoute(protectedRouter!, 'delete', '/oauth/clients/:clientId')).toBe(true);
  });
});
