import express from 'express';
import config from './config/index.js';
import { initMcpServer, registerAllTools } from './services/mcpService.js';
import { initMiddlewares } from './middlewares/index.js';
import { initRoutes } from './routes/index.js';
import { handleSseConnection, handleSseMessage } from './services/sseService.js';
import { migrateUserData } from './utils/migration.js';
import { initializeDefaultUser } from './models/User.js';

export class AppServer {
  private app: express.Application;
  private port: number | string;

  constructor() {
    this.app = express();
    this.port = config.port;
  }

  async initialize(): Promise<void> {
    try {
      // Migrate user data from users.json to mcp_settings.json if needed
      migrateUserData();

      // Initialize default admin user if no users exist
      await initializeDefaultUser();

      initMiddlewares(this.app);
      initRoutes(this.app);
      console.log('Server initialized successfully');

      initMcpServer(config.mcpHubName, config.mcpHubVersion)
        .then(() => {
          console.log('MCP server initialized successfully');
          this.app.get('/sse', (req, res) => handleSseConnection(req, res));
          this.app.post('/messages', handleSseMessage);
        })
        .catch((error) => {
          console.error('Error initializing MCP server:', error);
          throw error;
        });
    } catch (error) {
      console.error('Error initializing server:', error);
      throw error;
    }
  }

  start(): void {
    this.app.listen(this.port, () => {
      console.log(`Server is running on port ${this.port}`);
    });
  }

  getApp(): express.Application {
    return this.app;
  }
}

export default AppServer;
