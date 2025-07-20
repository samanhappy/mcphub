import { DataService } from './dataService.js';
import { getDataService } from './services.js';
import './services.js';

describe('DataService', () => {
  test('should get default implementation and call foo method', async () => {
    const dataService: DataService = await getDataService();
    const consoleSpy = jest.spyOn(console, 'log');
    dataService.foo();
    expect(consoleSpy).toHaveBeenCalledWith('default implementation');
    consoleSpy.mockRestore();
  });
});
