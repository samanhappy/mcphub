import { IUser, McpSettings } from '../types/index.js';
import { UserContextService } from './userContextService.js';
import { UserConfig } from '../types/index.js';

export class DataService {
  filterData(data: any[], user?: IUser): any[] {
    // Use passed user parameter if available, otherwise fall back to context
    const currentUser = user || UserContextService.getInstance().getCurrentUser();
    if (!currentUser || currentUser.isAdmin) {
      return data;
    } else {
      return data.filter((item) => item.owner === currentUser?.username);
    }
  }

  filterSettings(settings: McpSettings, user?: IUser): McpSettings {
    // Use passed user parameter if available, otherwise fall back to context
    const currentUser = user || UserContextService.getInstance().getCurrentUser();
    if (!currentUser || currentUser.isAdmin) {
      const result = { ...settings };
      delete result.userConfigs;
      return result;
    } else {
      const result = { ...settings };
      // TODO: apply userConfig to filter settings as needed
      // const userConfig = settings.userConfigs?.[currentUser?.username || ''];
      delete result.userConfigs;
      return result;
    }
  }

  mergeSettings(all: McpSettings, newSettings: McpSettings, user?: IUser): McpSettings {
    // Use passed user parameter if available, otherwise fall back to context
    const currentUser = user || UserContextService.getInstance().getCurrentUser();
    if (!currentUser || currentUser.isAdmin) {
      const result = { ...all };
      result.mcpServers = newSettings.mcpServers;
      result.users = newSettings.users;
      result.systemConfig = newSettings.systemConfig;
      result.groups = newSettings.groups;
      result.oauthClients = newSettings.oauthClients;
      result.oauthTokens = newSettings.oauthTokens;
      return result;
    } else {
      const result = JSON.parse(JSON.stringify(all));
      if (!result.userConfigs) {
        result.userConfigs = {};
      }
      const systemConfig = newSettings.systemConfig || {};
      const userConfig: UserConfig = {
        routing: systemConfig.routing
          ? {
              // TODO: only allow modifying certain fields based on userConfig permissions
            }
          : undefined,
      };
      result.userConfigs[currentUser?.username || ''] = userConfig;
      return result;
    }
  }

  getPermissions(user: IUser): string[] {
    if (user && user.isAdmin) {
      return ['*', 'x'];
    } else {
      return [''];
    }
  }
}
