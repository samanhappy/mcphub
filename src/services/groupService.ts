import { v4 as uuidv4 } from 'uuid';
import { IGroup, IGroupServerConfig } from '../types/index.js';
import { loadSettings, saveSettings } from '../config/index.js';
import { notifyToolChanged } from './mcpService.js';
import { getDataService } from './services.js';

// Helper function to normalize group servers configuration
const normalizeGroupServers = (servers: string[] | IGroupServerConfig[]): IGroupServerConfig[] => {
  return servers.map((server) => {
    if (typeof server === 'string') {
      // Backward compatibility: string format means all tools
      return { name: server, tools: 'all' };
    }
    // New format: ensure tools defaults to 'all' if not specified
    return { name: server.name, tools: server.tools || 'all' };
  });
};

// Get all groups
export const getAllGroups = (): IGroup[] => {
  const settings = loadSettings();
  const dataService = getDataService();
  return dataService.filterData
    ? dataService.filterData(settings.groups || [])
    : settings.groups || [];
};

// Get group by ID or name
export const getGroupByIdOrName = (key: string): IGroup | undefined => {
  const settings = loadSettings();
  const routingConfig = settings.systemConfig?.routing || {
    enableGlobalRoute: true,
    enableGroupNameRoute: true,
  };
  const groups = getAllGroups();
  return (
    groups.find(
      (group) => group.id === key || (group.name === key && routingConfig.enableGroupNameRoute),
    ) || undefined
  );
};

// Create a new group
export const createGroup = (
  name: string,
  description?: string,
  servers: string[] | IGroupServerConfig[] = [],
  owner?: string,
): IGroup | null => {
  try {
    const settings = loadSettings();
    const groups = settings.groups || [];

    // Check if group with same name already exists
    if (groups.some((group) => group.name === name)) {
      return null;
    }

    // Normalize servers configuration and filter out non-existent servers
    const normalizedServers = normalizeGroupServers(servers);
    const validServers: IGroupServerConfig[] = normalizedServers.filter(
      (serverConfig) => settings.mcpServers[serverConfig.name],
    );

    const newGroup: IGroup = {
      id: uuidv4(),
      name,
      description,
      servers: validServers,
      owner: owner || 'admin',
    };

    // Initialize groups array if it doesn't exist
    if (!settings.groups) {
      settings.groups = [];
    }

    settings.groups.push(newGroup);

    if (!saveSettings(settings)) {
      return null;
    }

    return newGroup;
  } catch (error) {
    console.error('Failed to create group:', error);
    return null;
  }
};

// Update an existing group
export const updateGroup = (id: string, data: Partial<IGroup>): IGroup | null => {
  try {
    const settings = loadSettings();
    if (!settings.groups) {
      return null;
    }

    const groupIndex = settings.groups.findIndex((group) => group.id === id);
    if (groupIndex === -1) {
      return null;
    }

    // Check for name uniqueness if name is being updated
    if (data.name && settings.groups.some((g) => g.name === data.name && g.id !== id)) {
      return null;
    }

    // If servers array is provided, validate server existence and normalize format
    if (data.servers) {
      const normalizedServers = normalizeGroupServers(data.servers);
      data.servers = normalizedServers.filter(
        (serverConfig) => settings.mcpServers[serverConfig.name],
      );
    }

    const updatedGroup = {
      ...settings.groups[groupIndex],
      ...data,
    };

    settings.groups[groupIndex] = updatedGroup;

    if (!saveSettings(settings)) {
      return null;
    }

    notifyToolChanged();
    return updatedGroup;
  } catch (error) {
    console.error(`Failed to update group ${id}:`, error);
    return null;
  }
};

// Update servers in a group (batch update)
// Update group servers (maintaining backward compatibility)
export const updateGroupServers = (
  groupId: string,
  servers: string[] | IGroupServerConfig[],
): IGroup | null => {
  try {
    const settings = loadSettings();
    if (!settings.groups) {
      return null;
    }

    const groupIndex = settings.groups.findIndex((group) => group.id === groupId);
    if (groupIndex === -1) {
      return null;
    }

    // Normalize and filter out non-existent servers
    const normalizedServers = normalizeGroupServers(servers);
    const validServers = normalizedServers.filter(
      (serverConfig) => settings.mcpServers[serverConfig.name],
    );

    settings.groups[groupIndex].servers = validServers;

    if (!saveSettings(settings)) {
      return null;
    }

    notifyToolChanged();
    return settings.groups[groupIndex];
  } catch (error) {
    console.error(`Failed to update servers for group ${groupId}:`, error);
    return null;
  }
};

// Delete a group
export const deleteGroup = (id: string): boolean => {
  try {
    const settings = loadSettings();
    if (!settings.groups) {
      return false;
    }

    const initialLength = settings.groups.length;
    settings.groups = settings.groups.filter((group) => group.id !== id);

    if (settings.groups.length === initialLength) {
      return false;
    }

    return saveSettings(settings);
  } catch (error) {
    console.error(`Failed to delete group ${id}:`, error);
    return false;
  }
};

// Add server to group
export const addServerToGroup = (groupId: string, serverName: string): IGroup | null => {
  try {
    const settings = loadSettings();
    if (!settings.groups) {
      return null;
    }

    // Verify server exists
    if (!settings.mcpServers[serverName]) {
      return null;
    }

    const groupIndex = settings.groups.findIndex((group) => group.id === groupId);
    if (groupIndex === -1) {
      return null;
    }

    const group = settings.groups[groupIndex];
    const normalizedServers = normalizeGroupServers(group.servers);

    // Add server to group if not already in it
    if (!normalizedServers.some((server) => server.name === serverName)) {
      normalizedServers.push({ name: serverName, tools: 'all' });
      group.servers = normalizedServers;

      if (!saveSettings(settings)) {
        return null;
      }
    }

    notifyToolChanged();
    return group;
  } catch (error) {
    console.error(`Failed to add server ${serverName} to group ${groupId}:`, error);
    return null;
  }
};

// Remove server from group
export const removeServerFromGroup = (groupId: string, serverName: string): IGroup | null => {
  try {
    const settings = loadSettings();
    if (!settings.groups) {
      return null;
    }

    const groupIndex = settings.groups.findIndex((group) => group.id === groupId);
    if (groupIndex === -1) {
      return null;
    }

    const group = settings.groups[groupIndex];
    const normalizedServers = normalizeGroupServers(group.servers);
    group.servers = normalizedServers.filter((server) => server.name !== serverName);

    if (!saveSettings(settings)) {
      return null;
    }

    return group;
  } catch (error) {
    console.error(`Failed to remove server ${serverName} from group ${groupId}:`, error);
    return null;
  }
};

// Get all servers in a group
export const getServersInGroup = (groupId: string): string[] => {
  const group = getGroupByIdOrName(groupId);
  if (!group) return [];
  const normalizedServers = normalizeGroupServers(group.servers);
  return normalizedServers.map((server) => server.name);
};

// Get server configuration from group (including tool selection)
export const getServerConfigInGroup = (
  groupId: string,
  serverName: string,
): IGroupServerConfig | undefined => {
  const group = getGroupByIdOrName(groupId);
  if (!group) return undefined;
  const normalizedServers = normalizeGroupServers(group.servers);
  return normalizedServers.find((server) => server.name === serverName);
};

// Get all server configurations in a group
export const getServerConfigsInGroup = (groupId: string): IGroupServerConfig[] => {
  const group = getGroupByIdOrName(groupId);
  if (!group) return [];
  return normalizeGroupServers(group.servers);
};

// Update tools selection for a specific server in a group
export const updateServerToolsInGroup = (
  groupId: string,
  serverName: string,
  tools: string[] | 'all',
): IGroup | null => {
  try {
    const settings = loadSettings();
    if (!settings.groups) {
      return null;
    }

    const groupIndex = settings.groups.findIndex((group) => group.id === groupId);
    if (groupIndex === -1) {
      return null;
    }

    // Verify server exists
    if (!settings.mcpServers[serverName]) {
      return null;
    }

    const group = settings.groups[groupIndex];
    const normalizedServers = normalizeGroupServers(group.servers);

    const serverIndex = normalizedServers.findIndex((server) => server.name === serverName);
    if (serverIndex === -1) {
      return null; // Server not in group
    }

    // Update the tools configuration for the server
    normalizedServers[serverIndex].tools = tools;
    group.servers = normalizedServers;

    if (!saveSettings(settings)) {
      return null;
    }

    notifyToolChanged();
    return group;
  } catch (error) {
    console.error(`Failed to update tools for server ${serverName} in group ${groupId}:`, error);
    return null;
  }
};
