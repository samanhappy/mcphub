import { Request, Response } from 'express';
import { ApiResponse } from '../types/index.js';
import {
  getAllGroups,
  getGroupByIdOrName,
  createGroup,
  updateGroup,
  updateGroupServers,
  deleteGroup,
  addServerToGroup,
  removeServerFromGroup,
} from '../services/groupService.js';

// Get all groups
export const getGroups = (_: Request, res: Response): void => {
  try {
    const groups = getAllGroups();
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
export const getGroup = (req: Request, res: Response): void => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({
        success: false,
        message: 'Group ID is required',
      });
      return;
    }

    const group = getGroupByIdOrName(id);
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
export const createNewGroup = (req: Request, res: Response): void => {
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
    const newGroup = createGroup(name, description, serverList);
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

// Update an existing group
export const updateExistingGroup = (req: Request, res: Response): void => {
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

    const updatedGroup = updateGroup(id, updateData);
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

// Update servers in a group (batch update)
export const updateGroupServersBatch = (req: Request, res: Response): void => {
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
        message: 'Servers must be an array of server names',
      });
      return;
    }

    const updatedGroup = updateGroupServers(id, servers);
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
export const deleteExistingGroup = (req: Request, res: Response): void => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({
        success: false,
        message: 'Group ID is required',
      });
      return;
    }

    const success = deleteGroup(id);
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
export const addServerToExistingGroup = (req: Request, res: Response): void => {
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

    const updatedGroup = addServerToGroup(id, serverName);
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
export const removeServerFromExistingGroup = (req: Request, res: Response): void => {
  try {
    const { id, serverName } = req.params;
    if (!id || !serverName) {
      res.status(400).json({
        success: false,
        message: 'Group ID and server name are required',
      });
      return;
    }

    const updatedGroup = removeServerFromGroup(id, serverName);
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
export const getGroupServers = (req: Request, res: Response): void => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({
        success: false,
        message: 'Group ID is required',
      });
      return;
    }

    const group = getGroupByIdOrName(id);
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
