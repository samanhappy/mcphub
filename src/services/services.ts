import { registerService, getService } from './registry.js';
import { DataService, DataServiceImpl } from './dataService.js';

registerService('dataService', {
  defaultImpl: DataServiceImpl,
});

export function getDataService(): DataService {
  return getService<DataService>('dataService');
}
