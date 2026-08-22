import express from 'express';
import cors, { type CorsOptions } from 'cors';
import config, { isWebDisabled } from './config/index.js';
import path from 'path';
import fs from 'fs';
import { initUpstreamServers, connected, cleanupAllServers } from './services/mcpService.js';
import { initMiddlewares } from './middlewares/index.js';
import { initRoutes } from './routes/index.js';
import { initI18n } from './utils/i18n.js';
import {
  handleSseConnection,
  handleSseMessage,
  handleMcpPostRequest,
  handleMcpOtherRequest,
} from './services/sseService.js';
import { initializeDefaultUser } from './models/User.js';
import { sseUserContextMiddleware } from './middlewares/userContext.js';
import { findPackageRoot } from './utils/path.js';
import { getCurrentModuleDir } from './utils/moduleDir.js';
import { initOAuthProvider, getOAuthRouter } from './services/oauthService.js';
import { initOAuthServer } from './services/oauthServerService.js';
import { safeStringify } from './utils/serialization.js';
import { resolveTrustProxySetting } from './utils/proxyTrust.js';
import { resolveCorsOrigin } from './utils/corsOrigin.js';
import { setFrontendDistPath } from './utils/frontendShell.js';
import http from 'http';
import type { Socket } from 'net';
import { mcpConnectionRateLimiter } from './utils/rateLimit.js';
import { closeHttpServer } from './utils/serverShutdown.js';
import { logger } from './utils/logger.js';

/**
 * Get the directory of the current module
 * This is wrapped in a function to allow easy mocking in test environments
 */
function getCurrentFileDir(): string {
  // In test environments, use process.cwd() to avoid import.meta issues
  if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined) {
    return process.cwd();
  }

  try {
    return getCurrentModuleDir();
  } catch {
    // Fallback for environments where import.meta might not be available
    return process.cwd();
  }
}

export class AppServer {
  private app: express.Application;
  private server: http.Server | null = null;
  private connections = new Set<Socket>();
  private port: number | string;
  private frontendPath: string | null = null;
  private basePath: string;
  private disableWeb: boolean;

  constructor() {
    this.app = express();
    this.app.set('trust proxy', resolveTrustProxySetting());
    // Delegate-based CORS so the Host header is available for the same-host
    // check inside resolveCorsOrigin.
    this.app.use(
      cors(
        (
          req: import('express').Request,
          callback: (err: Error | null, options?: CorsOptions) => void,
        ) => {
          const origin = resolveCorsOrigin(
            req.headers.origin,
            req.headers.host,
            process.env.ALLOWED_ORIGINS,
          );
          callback(null, { origin: origin === false ? false : origin, credentials: true });
        },
      ),
    );
    this.port = config.port;
    this.basePath = config.basePath;
    this.disableWeb = isWebDisabled();
  }

  async initialize(): Promise<void> {
    try {
      // Initialize i18n before other components
      await initI18n();
      logger.log('i18n initialized successfully');

      // Initialize default admin user if no users exist
      await initializeDefaultUser();

      // Initialize OAuth provider if configured (for proxying upstream MCP OAuth)
      await initOAuthProvider();
      const oauthRouter = getOAuthRouter();
      if (oauthRouter) {
        // Mount OAuth router at the root level (before other routes)
        // This must be at root level as per MCP OAuth specification
        this.app.use(oauthRouter);
        logger.log('OAuth router mounted successfully');
      }

      // Initialize OAuth authorization server (for MCPHub's own OAuth)
      await initOAuthServer();

      initMiddlewares(this.app);
      await initRoutes(this.app);
      logger.log('Server initialized successfully');

      initUpstreamServers()
        .then(() => {
          logger.log('MCP server initialized successfully');

          // Original routes (global and group-based)
          this.app.get(
            `${this.basePath}/sse/:group(.*)?`,
            mcpConnectionRateLimiter,
            sseUserContextMiddleware,
            (req, res) => handleSseConnection(req, res),
          );
          this.app.post(
            `${this.basePath}/messages`,
            mcpConnectionRateLimiter,
            sseUserContextMiddleware,
            handleSseMessage,
          );
          this.app.post(
            `${this.basePath}/mcp/:group(.*)?`,
            mcpConnectionRateLimiter,
            sseUserContextMiddleware,
            handleMcpPostRequest,
          );
          this.app.get(
            `${this.basePath}/mcp/:group(.*)?`,
            mcpConnectionRateLimiter,
            sseUserContextMiddleware,
            handleMcpOtherRequest,
          );
          this.app.delete(
            `${this.basePath}/mcp/:group(.*)?`,
            mcpConnectionRateLimiter,
            sseUserContextMiddleware,
            handleMcpOtherRequest,
          );

          // User-scoped routes with user context middleware
          this.app.get(
            `${this.basePath}/:user/sse/:group(.*)?`,
            mcpConnectionRateLimiter,
            sseUserContextMiddleware,
            (req, res) => handleSseConnection(req, res),
          );
          this.app.post(
            `${this.basePath}/:user/messages`,
            mcpConnectionRateLimiter,
            sseUserContextMiddleware,
            handleSseMessage,
          );
          this.app.post(
            `${this.basePath}/:user/mcp/:group(.*)?`,
            mcpConnectionRateLimiter,
            sseUserContextMiddleware,
            handleMcpPostRequest,
          );
          this.app.get(
            `${this.basePath}/:user/mcp/:group(.*)?`,
            mcpConnectionRateLimiter,
            sseUserContextMiddleware,
            handleMcpOtherRequest,
          );
          this.app.delete(
            `${this.basePath}/:user/mcp/:group(.*)?`,
            mcpConnectionRateLimiter,
            sseUserContextMiddleware,
            handleMcpOtherRequest,
          );
        })
        .catch((error) => {
          logger.error('Error initializing MCP server', safeStringify({ error }));
          throw error;
        })
        .finally(() => {
          // Find and serve frontend
          this.findAndServeFrontend();
        });
    } catch (error) {
      logger.error('Error initializing server', safeStringify({ error }));
      throw error;
    }
  }

  private findAndServeFrontend(): void {
    if (this.disableWeb) {
      logger.log('Web UI disabled via DISABLE_WEB=true. Server will run without frontend.');
      this.registerFrontendUnavailableRoute();
      return;
    }

    // Find frontend path
    this.frontendPath = this.findFrontendDistPath();
    // Register the discovered SPA build so server-rendered pages (e.g. the
    // OAuth consent screen) can boot the shell with injected context.
    setFrontendDistPath(this.frontendPath);

    if (this.frontendPath) {
      logger.log('Serving frontend', JSON.stringify({ frontendPath: this.frontendPath }));
      // Serve static files with base path
      this.app.use(this.basePath, express.static(this.frontendPath));

      // Add the wildcard route for SPA with base path
      if (fs.existsSync(path.join(this.frontendPath, 'index.html'))) {
        this.app.get(`${this.basePath}/*`, (_req, res) => {
          res.sendFile(path.join(this.frontendPath!, 'index.html'));
        });

        // Also handle root redirect if base path is set
        if (this.basePath) {
          this.app.get('/', (_req, res) => {
            res.redirect(this.basePath);
          });
        }
      }
    } else {
      logger.warn('Frontend dist directory not found. Server will run without frontend.');
      this.registerFrontendUnavailableRoute();
    }
  }

  start(): void {
    this.server = this.app.listen(this.port, () => {
      logger.log(`Server is running on port ${this.port}`);
      if (this.frontendPath && !this.disableWeb) {
        logger.log(`Open http://localhost:${this.port} in your browser to access MCPHub UI`);
      } else {
        logger.log(
          `MCPHub API is running on http://localhost:${this.port}, but the UI is not available`,
        );
      }
    });
    this.server.on('connection', (socket) => {
      this.connections.add(socket);
      socket.once('close', () => this.connections.delete(socket));
    });
  }

  /**
   * Gracefully shutdown the server
   */
  async shutdown(): Promise<void> {
    logger.log('[SHUTDOWN] Starting graceful shutdown...');

    // Stop accepting new connections while existing requests finish within the grace period.
    const httpShutdown = this.server
      ? closeHttpServer(this.server, this.connections)
      : Promise.resolve();

    // Close all MCP clients
    try {
      cleanupAllServers();
      logger.log('[SHUTDOWN] MCP clients closed');
    } catch (error) {
      logger.error('[SHUTDOWN] Error closing MCP clients', safeStringify({ error }));
    }

    await httpShutdown;
    this.server = null;

    // Close database connection if in database mode
    const useDatabase =
      process.env.USE_DB !== undefined ? process.env.USE_DB === 'true' : !!process.env.DB_URL;
    if (useDatabase) {
      try {
        const { closeDatabase } = await import('./db/connection.js');
        await closeDatabase();
        logger.log('[SHUTDOWN] Database connection closed');
      } catch (error) {
        logger.error('[SHUTDOWN] Error closing database', safeStringify({ error }));
      }
    }

    logger.log('[SHUTDOWN] Graceful shutdown completed');
  }

  connected(): boolean {
    return connected();
  }

  getApp(): express.Application {
    return this.app;
  }

  // Helper method to find frontend dist path in different environments
  private findFrontendDistPath(): string | null {
    // Debug flag for detailed logging
    const debug = process.env.DEBUG === 'true';
    const currentDir = getCurrentFileDir();

    if (debug) {
      logger.log('DEBUG: Current directory:', process.cwd());
      logger.log('DEBUG: Script directory:', currentDir);
    }

    // First, find the package root directory
    const packageRoot = this.findPackageRoot();

    if (debug) {
      logger.log('DEBUG: Using package root:', packageRoot);
    }

    if (!packageRoot) {
      logger.warn('Could not determine package root directory');
      return null;
    }

    // Check for frontend dist in the standard location
    const frontendDistPath = path.join(packageRoot, 'frontend', 'dist');

    if (debug) {
      logger.log(`DEBUG: Checking frontend at: ${frontendDistPath}`);
    }

    if (
      fs.existsSync(frontendDistPath) &&
      fs.existsSync(path.join(frontendDistPath, 'index.html'))
    ) {
      return frontendDistPath;
    }

    logger.warn('Frontend distribution not found', { frontendDistPath });
    return null;
  }

  // Helper method to find the package root (where package.json is located)
  private findPackageRoot(): string | null {
    // Use the shared utility function which properly handles ESM module paths
    const currentDir = getCurrentFileDir();
    return findPackageRoot(currentDir);
  }

  private registerFrontendUnavailableRoute(): void {
    const rootPath = this.basePath || '/';
    this.app.get(rootPath, (_req, res) => {
      res
        .status(404)
        .send('Frontend not found. MCPHub API is running, but the UI is not available.');
    });
  }
}

export default AppServer;
