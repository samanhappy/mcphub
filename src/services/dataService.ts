import { IUser, McpSettings } from '../types/index.js';

export interface DataService {
  foo(): void;
  filterData(data: any[], user?: IUser): any[];
  filterSettings(settings: McpSettings, user?: IUser): McpSettings;
  mergeSettings(all: McpSettings, newSettings: McpSettings, user?: IUser): McpSettings;
  getPermissions(user: IUser): string[];
}

export class DataServiceImpl implements DataService {
  foo() {
    console.log('default implementation');
  }

  filterData(data: any[], _user?: IUser): any[] {
    return data;
  }

  filterSettings(settings: McpSettings, _user?: IUser): McpSettings {
    return settings;
  }

  mergeSettings(all: McpSettings, newSettings: McpSettings, _user?: IUser): McpSettings {
    return newSettings;
  }

  getPermissions(_user: IUser): string[] {
    return ['*'];
  }
}
