import { DataService } from './dataService.js';

export function getDataService(): DataService {
  return new DataService();
}
