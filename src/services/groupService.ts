import { v4 as uuidv4 } from 'uuid';
import { IGroup } from '../types/index.js';
import { loadSettings, saveSettings } from '../config/index.js';
import { notifyToolChanged } from './mcpService.js';

// Get all groups
export const getAllGroups = (): IGroup[] => {
  const settings = loadSettings();
  return settings.groups || [];
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
  servers: string[] = [],
): IGroup | null => {
  try {
    const settings = loadSettings();
    const groups = settings.groups || [];

    // Check if group with same name already exists
    if (groups.some((group) => group.name === name)) {
      return null;
    }

    // Filter out non-existent servers
    const validServers = servers.filter((serverName) => settings.mcpServers[serverName]);

    const newGroup: IGroup = {
      id: uuidv4(),
      name,
      description,
      servers: validServers,
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

    // If servers array is provided, validate server existence
    if (data.servers) {
      data.servers = data.servers.filter((serverName) => settings.mcpServers[serverName]);
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
export const updateGroupServers = (groupId: string, servers: string[]): IGroup | null => {
  try {
    const settings = loadSettings();
    if (!settings.groups) {
      return null;
    }

    const groupIndex = settings.groups.findIndex((group) => group.id === groupId);
    if (groupIndex === -1) {
      return null;
    }

    // Filter out non-existent servers
    const validServers = servers.filter((serverName) => settings.mcpServers[serverName]);

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

    // Add server to group if not already in it
    if (!group.servers.includes(serverName)) {
      group.servers.push(serverName);

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
    group.servers = group.servers.filter((name) => name !== serverName);

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
  return group ? group.servers : [];
};
