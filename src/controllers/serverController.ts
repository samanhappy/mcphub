import { Request, Response } from 'express';
import { ApiResponse, AddServerRequest } from '../types/index.js';
import {
  getServersInfo,
  addServer,
  removeServer,
  updateMcpServer,
  notifyToolChanged,
  toggleServerStatus,
} from '../services/mcpService.js';
import { loadSettings } from '../config/index.js';

export const getAllServers = (_: Request, res: Response): void => {
  try {
    const serversInfo = getServersInfo();
    const response: ApiResponse = {
      success: true,
      data: serversInfo,
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get servers information',
    });
  }
};

export const getAllSettings = (_: Request, res: Response): void => {
  try {
    const settings = loadSettings();
    const response: ApiResponse = {
      success: true,
      data: settings,
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get server settings',
    });
  }
};

export const createServer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, config } = req.body as AddServerRequest;
    if (!name || typeof name !== 'string') {
      res.status(400).json({
        success: false,
        message: 'Server name is required',
      });
      return;
    }

    if (!config || typeof config !== 'object') {
      res.status(400).json({
        success: false,
        message: 'Server configuration is required',
      });
      return;
    }

    if (!config.url && (!config.command || !config.args)) {
      res.status(400).json({
        success: false,
        message: 'Server configuration must include either a URL or command with arguments',
      });
      return;
    }

    const result = await addServer(name, config);
    if (result.success) {
      notifyToolChanged();
      res.json({
        success: true,
        message: 'Server added successfully',
      });
    } else {
      res.status(400).json({
        success: false,
        message: result.message || 'Failed to add server',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const deleteServer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.params;
    if (!name) {
      res.status(400).json({
        success: false,
        message: 'Server name is required',
      });
      return;
    }

    const result = removeServer(name);
    if (result.success) {
      notifyToolChanged();
      res.json({
        success: true,
        message: 'Server removed successfully',
      });
    } else {
      res.status(404).json({
        success: false,
        message: result.message || 'Server not found or failed to remove',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const updateServer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.params;
    const { config } = req.body;
    if (!name) {
      res.status(400).json({
        success: false,
        message: 'Server name is required',
      });
      return;
    }

    if (!config || typeof config !== 'object') {
      res.status(400).json({
        success: false,
        message: 'Server configuration is required',
      });
      return;
    }

    if (!config.url && (!config.command || !config.args)) {
      res.status(400).json({
        success: false,
        message: 'Server configuration must include either a URL or command with arguments',
      });
      return;
    }

    const result = await updateMcpServer(name, config);
    if (result.success) {
      notifyToolChanged();
      res.json({
        success: true,
        message: 'Server updated successfully',
      });
    } else {
      res.status(404).json({
        success: false,
        message: result.message || 'Server not found or failed to update',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};

export const getServerConfig = (req: Request, res: Response): void => {
  try {
    const { name } = req.params;
    const settings = loadSettings();
    if (!settings.mcpServers || !settings.mcpServers[name]) {
      res.status(404).json({
        success: false,
        message: 'Server not found',
      });
      return;
    }

    const serverInfo = getServersInfo().find((s) => s.name === name);
    const serverConfig = settings.mcpServers[name];
    const response: ApiResponse = {
      success: true,
      data: {
        name,
        status: serverInfo ? serverInfo.status : 'disconnected',
        tools: serverInfo ? serverInfo.tools : [],
        config: serverConfig,
      },
    };

    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get server configuration',
    });
  }
};

export const toggleServer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.params;
    const { enabled } = req.body;
    if (!name) {
      res.status(400).json({
        success: false,
        message: 'Server name is required',
      });
      return;
    }

    if (typeof enabled !== 'boolean') {
      res.status(400).json({
        success: false,
        message: 'Enabled status must be a boolean',
      });
      return;
    }

    const result = await toggleServerStatus(name, enabled);
    if (result.success) {
      notifyToolChanged();
      res.json({
        success: true,
        message: result.message || `Server ${enabled ? 'enabled' : 'disabled'} successfully`,
      });
    } else {
      res.status(404).json({
        success: false,
        message: result.message || 'Server not found or failed to toggle status',
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Internal server error',
    });
  }
};
