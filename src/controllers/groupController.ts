import { Request, Response } from 'express';
import {
  ApiResponse,
  AddGroupRequest,
  BatchCreateGroupsRequest,
  BatchCreateGroupsResponse,
  BatchGroupResult,
} from '../types/index.js';
import {
  getAllGroups,
  getGroupByIdOrName,
  createGroup,
  updateGroup,
  updateGroupServers,
  deleteGroup,
  addServerToGroup,
  removeServerFromGroup,
  getServerConfigInGroup,
  getServerConfigsInGroup,
  updateServerToolsInGroup,
} from '../services/groupService.js';

// Get all groups
export const getGroups = async (_: Request, res: Response): Promise<void> => {
  try {
    const groups = await getAllGroups();
    const response: ApiResponse = {
      success: true,
      data: groups,
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get groups information',
    });
  }
};

// Get a specific group by ID
export const getGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({
        success: false,
        message: 'Group ID is required',
      });
      return;
    }

    const group = await getGroupByIdOrName(id);
    if (!group) {
      res.status(404).json({
        success: false,
        message: 'Group not found',
      });
      return;
    }

    const response: ApiResponse = {
      success: true,
      data: group,
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get group information',
    });
  }
};

// Create a new group
export const createNewGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, description, servers } = req.body;
    if (!name) {
      res.status(400).json({
        success: false,
        message: 'Group name is required',
      });
      return;
    }

    const serverList = Array.isArray(servers) ? servers : [];

    // Set owner property - use current user's username, default to 'admin'
    const currentUser = (req as any).user;
    const owner = currentUser?.username || 'admin';

    const newGroup = await createGroup(name, description, serverList, owner);
    if (!newGroup) {
      res.status(400).json({
        success: false,
        message: 'Failed to create group or group name already exists',
      });
      return;
    }

    const response: ApiResponse = {
      success: true,
      data: newGroup,
      message: 'Group created successfully',
    };
    res.status(201).json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Batch create groups - validates and creates multiple groups in one request
export const batchCreateGroups = async (req: Request, res: Response): Promise<void> => {
  try {
    const { groups } = req.body as BatchCreateGroupsRequest;

    // Validate request body
    if (!groups || !Array.isArray(groups)) {
      res.status(400).json({
        success: false,
        message: 'Request body must contain a "groups" array',
      });
      return;
    }

    if (groups.length === 0) {
      res.status(400).json({
        success: false,
        message: 'Groups array cannot be empty',
      });
      return;
    }

    // Helper function to validate a single group configuration
    const validateGroupConfig = (group: AddGroupRequest): { valid: boolean; message?: string } => {
      if (!group.name || typeof group.name !== 'string') {
        return { valid: false, message: 'Group name is required and must be a string' };
      }

      if (group.description !== undefined && typeof group.description !== 'string') {
        return { valid: false, message: 'Group description must be a string' };
      }

      if (group.servers !== undefined && !Array.isArray(group.servers)) {
        return { valid: false, message: 'Group servers must be an array' };
      }

      // Validate server configurations if provided in new format
      if (group.servers) {
        for (const server of group.servers) {
          if (typeof server === 'object' && server !== null) {
            if (!server.name || typeof server.name !== 'string') {
              return {
                valid: false,
                message: 'Server configuration must have a name property',
              };
            }

            if (
              server.tools !== undefined &&
              server.tools !== 'all' &&
              !Array.isArray(server.tools)
            ) {
              return {
                valid: false,
                message: 'Server tools must be "all" or an array of tool names',
              };
            }
          }
        }
      }

      return { valid: true };
    };

    // Process each group
    const results: BatchGroupResult[] = [];
    let successCount = 0;
    let failureCount = 0;

    // Get current user for owner field
    const currentUser = (req as any).user;
    const defaultOwner = currentUser?.username || 'admin';

    for (const groupData of groups) {
      const { name, description, servers } = groupData;

      // Validate group configuration
      const validation = validateGroupConfig(groupData);
      if (!validation.valid) {
        results.push({
          name: name || 'unknown',
          success: false,
          message: validation.message,
        });
        failureCount++;
        continue;
      }

      try {
        const serverList = Array.isArray(servers) ? servers : [];
        const newGroup = await createGroup(name, description, serverList, defaultOwner);

        if (newGroup) {
          results.push({
            name,
            success: true,
            message: 'Group created successfully',
          });
          successCount++;
        } else {
          results.push({
            name,
            success: false,
            message: 'Failed to create group or group name already exists',
          });
          failureCount++;
        }
      } catch (error) {
        results.push({
          name,
          success: false,
          message: error instanceof Error ? error.message : 'Failed to create group',
        });
        failureCount++;
      }
    }

    // Return response
    const response: BatchCreateGroupsResponse = {
      success: successCount > 0,
      successCount,
      failureCount,
      results,
    };

    // Use 207 Multi-Status if there were partial failures, 200 if all succeeded
    const statusCode = failureCount > 0 && successCount > 0 ? 207 : successCount > 0 ? 200 : 400;
    res.status(statusCode).json(response);
  } catch (error) {
    console.error('Batch create groups error:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update an existing group
export const updateExistingGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { name, description, servers } = req.body;
    if (!id) {
      res.status(400).json({
        success: false,
        message: 'Group ID is required',
      });
      return;
    }

    // Allow updating servers along with other fields
    const updateData: any = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (servers !== undefined) updateData.servers = servers;

    if (Object.keys(updateData).length === 0) {
      res.status(400).json({
        success: false,
        message: 'At least one field (name, description, or servers) is required to update',
      });
      return;
    }

    const updatedGroup = await updateGroup(id, updateData);
    if (!updatedGroup) {
      res.status(404).json({
        success: false,
        message: 'Group not found or name already exists',
      });
      return;
    }

    const response: ApiResponse = {
      success: true,
      data: updatedGroup,
      message: 'Group updated successfully',
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Update servers in a group (batch update) - supports both string[] and server config format
export const updateGroupServersBatch = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { servers } = req.body;

    if (!id) {
      res.status(400).json({
        success: false,
        message: 'Group ID is required',
      });
      return;
    }

    if (!Array.isArray(servers)) {
      res.status(400).json({
        success: false,
        message: 'Servers must be an array of server names or server configurations',
      });
      return;
    }

    // Validate server configurations if provided in new format
    for (const server of servers) {
      if (typeof server === 'object' && server !== null) {
        if (!server.name || typeof server.name !== 'string') {
          res.status(400).json({
            success: false,
            message: 'Each server configuration must have a valid name',
          });
          return;
        }
        if (
          server.tools &&
          server.tools !== 'all' &&
          (!Array.isArray(server.tools) ||
            !server.tools.every((tool: any) => typeof tool === 'string'))
        ) {
          res.status(400).json({
            success: false,
            message: 'Tools must be "all" or an array of strings',
          });
          return;
        }
      }
    }

    const updatedGroup = await updateGroupServers(id, servers);
    if (!updatedGroup) {
      res.status(404).json({
        success: false,
        message: 'Group not found',
      });
      return;
    }

    const response: ApiResponse = {
      success: true,
      data: updatedGroup,
      message: 'Group servers updated successfully',
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Delete a group
export const deleteExistingGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({
        success: false,
        message: 'Group ID is required',
      });
      return;
    }

    const success = await deleteGroup(id);
    if (!success) {
      res.status(404).json({
        success: false,
        message: 'Group not found or failed to delete',
      });
      return;
    }

    res.json({
      success: true,
      message: 'Group deleted successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Add server to a group
export const addServerToExistingGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { serverName } = req.body;
    if (!id) {
      res.status(400).json({
        success: false,
        message: 'Group ID is required',
      });
      return;
    }

    if (!serverName) {
      res.status(400).json({
        success: false,
        message: 'Server name is required',
      });
      return;
    }

    const updatedGroup = await addServerToGroup(id, serverName);
    if (!updatedGroup) {
      res.status(404).json({
        success: false,
        message: 'Group or server not found',
      });
      return;
    }

    const response: ApiResponse = {
      success: true,
      data: updatedGroup,
      message: 'Server added to group successfully',
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Remove server from a group
export const removeServerFromExistingGroup = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, serverName } = req.params;
    if (!id || !serverName) {
      res.status(400).json({
        success: false,
        message: 'Group ID and server name are required',
      });
      return;
    }

    const updatedGroup = await removeServerFromGroup(id, serverName);
    if (!updatedGroup) {
      res.status(404).json({
        success: false,
        message: 'Group not found',
      });
      return;
    }

    const response: ApiResponse = {
      success: true,
      data: updatedGroup,
      message: 'Server removed from group successfully',
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

// Get servers in a group
export const getGroupServers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({
        success: false,
        message: 'Group ID is required',
      });
      return;
    }

    const group = await getGroupByIdOrName(id);
    if (!group) {
      res.status(404).json({
        success: false,
        message: 'Group not found',
      });
      return;
    }

    const response: ApiResponse = {
      success: true,
      data: group.servers,
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get group servers',
    });
  }
};

// Get server configurations in a group (including tool selections)
export const getGroupServerConfigs = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({
        success: false,
        message: 'Group ID is required',
      });
      return;
    }

    const serverConfigs = await getServerConfigsInGroup(id);
    const response: ApiResponse = {
      success: true,
      data: serverConfigs,
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get group server configurations',
    });
  }
};

// Get specific server configuration in a group
export const getGroupServerConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, serverName } = req.params;
    if (!id || !serverName) {
      res.status(400).json({
        success: false,
        message: 'Group ID and server name are required',
      });
      return;
    }

    const serverConfig = await getServerConfigInGroup(id, serverName);
    if (!serverConfig) {
      res.status(404).json({
        success: false,
        message: 'Server not found in group',
      });
      return;
    }

    const response: ApiResponse = {
      success: true,
      data: serverConfig,
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get server configuration',
    });
  }
};

// Update tools for a specific server in a group
export const updateGroupServerTools = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id, serverName } = req.params;
    const { tools } = req.body;

    if (!id || !serverName) {
      res.status(400).json({
        success: false,
        message: 'Group ID and server name are required',
      });
      return;
    }

    // Validate tools parameter
    if (
      tools !== 'all' &&
      (!Array.isArray(tools) || !tools.every((tool) => typeof tool === 'string'))
    ) {
      res.status(400).json({
        success: false,
        message: 'Tools must be "all" or an array of strings',
      });
      return;
    }

    const updatedGroup = await updateServerToolsInGroup(id, serverName, tools);
    if (!updatedGroup) {
      res.status(404).json({
        success: false,
        message: 'Group or server not found',
      });
      return;
    }

    const response: ApiResponse = {
      success: true,
      data: updatedGroup,
      message: 'Server tools updated successfully',
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
