import { IUser, McpSettings } from '../types/index.js';

export interface DataService {
  foo(): void;
  filterData(data: any[]): any[];
  filterSettings(settings: McpSettings): McpSettings;
  mergeSettings(all: McpSettings, newSettings: McpSettings): McpSettings;
  getPermissions(user: IUser): string[];
}

export class DataServiceImpl implements DataService {
  foo() {
    console.log('default implementation');
  }

  filterData(data: any[]): any[] {
    return data;
  }

  filterSettings(settings: McpSettings): McpSettings {
    return settings;
  }

  mergeSettings(all: McpSettings, newSettings: McpSettings): McpSettings {
    return newSettings;
  }

  getPermissions(_user: IUser): string[] {
    return ['*'];
  }
}
