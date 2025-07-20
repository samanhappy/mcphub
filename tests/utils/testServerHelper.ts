import { Server } from 'http';
import { AppServer } from '../../src/server.js';
import { McpSettings } from '../../src/types/index.js';
import * as fs from 'fs';
import * as path from 'path';
import { createMockSettings } from './mockSettings.js';
import { clearSettingsCache } from '../../src/config/index.js';

/**
 * Test server helper class for managing AppServer instances during testing
 */
export class TestServerHelper {
  private appServer: AppServer | null = null;
  private httpServer: Server | null = null;
  private originalConfigPath: string | null = null;
  private testConfigPath: string | null = null;

  /**
   * Creates and initializes a test server with mock settings
   * @param mockSettings Optional mock settings to use
   * @returns Object containing server instance and base URL
   */
  async createTestServer(mockSettings?: McpSettings): Promise<{
    appServer: AppServer;
    httpServer: Server;
    baseURL: string;
    port: number;
  }> {
    // Use provided mock settings or create default ones
    const settings = mockSettings || createMockSettings();

    // Create temporary config file for testing
    await this.setupTemporaryConfig(settings);

    // Create and initialize AppServer
    this.appServer = new AppServer();
    await this.appServer.initialize();

    // Wait for server connection with timeout
    const maxAttempts = 30;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      if (this.appServer.connected()) {
        console.log('Test server is ready');
        break;
      } else if (attempt === maxAttempts - 1) {
        throw new Error('Test server did not become ready in time');
      }
      console.log(`Waiting for test server to be ready... Attempt ${attempt + 1}/${maxAttempts}`);
      await delay(3000); // Short delay between checks
    }

    // Start server on random available port
    const app = this.appServer.getApp();
    this.httpServer = app.listen(0);

    const address = this.httpServer.address();
    const port = typeof address === 'object' && address ? address.port : 3000;
    const baseURL = `http://localhost:${port}`;

    return {
      appServer: this.appServer,
      httpServer: this.httpServer,
      baseURL,
      port,
    };
  }

  /**
   * Closes the test server and cleans up temporary files
   */
  async closeTestServer(): Promise<void> {
    if (this.httpServer) {
      await new Promise<void>((resolve) => {
        this.httpServer!.close(() => resolve());
      });
      this.httpServer = null;
    }

    this.appServer = null;

    // Clean up temporary config file
    await this.cleanupTemporaryConfig();
  }

  /**
   * Sets up a temporary config file for testing
   * @param settings Mock settings to write to the config file
   */
  private async setupTemporaryConfig(settings: McpSettings): Promise<void> {
    // Store original path if it exists
    this.originalConfigPath = process.env.MCPHUB_SETTING_PATH || null;

    const configDir = path.join(process.cwd(), 'temp-test-config');

    // Create temp config directory if it doesn't exist
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    this.testConfigPath = path.join(configDir, 'mcp_settings.json');

    // Write mock settings to temporary file
    fs.writeFileSync(this.testConfigPath, JSON.stringify(settings, null, 2));

    // Override the settings path for the test
    process.env.MCPHUB_SETTING_PATH = this.testConfigPath;

    // Clear settings cache to force re-reading from the new config file
    clearSettingsCache();

    console.log(`Set test config path: ${this.testConfigPath}`);
  }

  /**
   * Cleans up the temporary config file
   */
  private async cleanupTemporaryConfig(): Promise<void> {
    if (this.testConfigPath && fs.existsSync(this.testConfigPath)) {
      fs.unlinkSync(this.testConfigPath);

      // Try to remove the temp directory if empty
      const configDir = path.dirname(this.testConfigPath);
      try {
        fs.rmdirSync(configDir);
      } catch (error) {
        // Ignore error if directory is not empty
      }
    }

    // Reset environment variable
    if (this.originalConfigPath !== null) {
      process.env.MCPHUB_SETTING_PATH = this.originalConfigPath;
    } else {
      delete process.env.MCPHUB_SETTING_PATH;
    }

    this.testConfigPath = null;
  }
}

/**
 * Waits for a server to be ready by attempting to connect
 * @param baseURL Base URL of the server
 * @param maxAttempts Maximum number of connection attempts
 * @param delay Delay between attempts in milliseconds
 */
export const waitForServerReady = async (
  baseURL: string,
  maxAttempts = 10,
  delay = 500,
): Promise<void> => {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const response = await fetch(`${baseURL}/health`);
      if (response.ok || response.status === 404) {
        return; // Server is responding
      }
    } catch (error) {
      // Server not ready yet
    }

    if (i < maxAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error(`Server at ${baseURL} not ready after ${maxAttempts} attempts`);
};

/**
 * Creates a promise that resolves after the specified delay
 * @param ms Delay in milliseconds
 */
export const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};
