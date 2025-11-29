import 'reflect-metadata';
import AppServer from './server.js';
import { initializeDatabaseMode } from './utils/migration.js';

const appServer = new AppServer();

async function boot() {
  try {
    // Check if database mode is enabled
    // If USE_DB is explicitly set, use its value; otherwise, auto-detect based on DB_URL presence
    const useDatabase =
      process.env.USE_DB !== undefined ? process.env.USE_DB === 'true' : !!process.env.DB_URL;
    if (useDatabase) {
      console.log('Database mode enabled, initializing...');
      const dbInitialized = await initializeDatabaseMode();
      if (!dbInitialized) {
        console.error('Failed to initialize database mode');
        process.exit(1);
      }
    }

    await appServer.initialize();
    appServer.start();
  } catch (error) {
    console.error('Failed to start application:', error);
    process.exit(1);
  }
}

boot();

export default appServer.getApp();
