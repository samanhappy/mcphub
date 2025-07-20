import { registerService, getService } from './registry.js';
import { DataService, DataServiceImpl } from './dataService.js';

let initialized = false;
let tempDataService: DataService | null = null;

async function initializeServices() {
  if (initialized) return;

  await registerService('dataService', {
    defaultImpl: DataServiceImpl,
  });

  initialized = true;
  tempDataService = null; // Clear temp service once real one is ready
}

export function getDataService(): DataService {
  if (initialized) {
    return getService<DataService>('dataService');
  }

  // Return temporary service for cases where services haven't been initialized yet
  // This allows module loading to work even before server initialization
  if (!tempDataService) {
    tempDataService = new DataServiceImpl();
  }
  return tempDataService;
}

export { initializeServices };
