import { Request, Response } from 'express';
import { ApiResponse, CloudServer, CloudTool } from '../types/index.js';
import {
  getCloudServers,
  getCloudServerByName,
  getCloudServerTools,
  callCloudServerTool,
  getCloudCategories,
  getCloudTags,
  searchCloudServers,
  filterCloudServersByCategory,
  filterCloudServersByTag,
} from '../services/cloudService.js';

// Get all cloud market servers
export const getAllCloudServers = async (_: Request, res: Response): Promise<void> => {
  try {
    const cloudServers = await getCloudServers();
    const response: ApiResponse<CloudServer[]> = {
      success: true,
      data: cloudServers,
    };
    res.json(response);
  } catch (error) {
    console.error('Error getting cloud market servers:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to get cloud market servers';
    res.status(500).json({
      success: false,
      message: errorMessage,
    });
  }
};

// Get a specific cloud market server by name
export const getCloudServer = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.params;
    if (!name) {
      res.status(400).json({
        success: false,
        message: 'Server name is required',
      });
      return;
    }

    const server = await getCloudServerByName(name);
    if (!server) {
      res.status(404).json({
        success: false,
        message: 'Cloud server not found',
      });
      return;
    }

    // Fetch tools for this server
    try {
      const tools = await getCloudServerTools(server.server_key);
      server.tools = tools;
    } catch (toolError) {
      console.warn(`Failed to fetch tools for server ${server.name}:`, toolError);
      // Continue without tools
    }

    const response: ApiResponse<CloudServer> = {
      success: true,
      data: server,
    };
    res.json(response);
  } catch (error) {
    console.error('Error getting cloud market server:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to get cloud market server';
    res.status(500).json({
      success: false,
      message: errorMessage,
    });
  }
};

// Get all cloud market categories
export const getAllCloudCategories = async (_: Request, res: Response): Promise<void> => {
  try {
    const categories = await getCloudCategories();
    const response: ApiResponse<string[]> = {
      success: true,
      data: categories,
    };
    res.json(response);
  } catch (error) {
    console.error('Error getting cloud market categories:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to get cloud market categories';
    res.status(500).json({
      success: false,
      message: errorMessage,
    });
  }
};

// Get all cloud market tags
export const getAllCloudTags = async (_: Request, res: Response): Promise<void> => {
  try {
    const tags = await getCloudTags();
    const response: ApiResponse<string[]> = {
      success: true,
      data: tags,
    };
    res.json(response);
  } catch (error) {
    console.error('Error getting cloud market tags:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to get cloud market tags';
    res.status(500).json({
      success: false,
      message: errorMessage,
    });
  }
};

// Search cloud market servers
export const searchCloudServersByQuery = async (req: Request, res: Response): Promise<void> => {
  try {
    const query = req.query.query as string;
    if (!query || query.trim() === '') {
      res.status(400).json({
        success: false,
        message: 'Search query is required',
      });
      return;
    }

    const servers = await searchCloudServers(query);
    const response: ApiResponse<CloudServer[]> = {
      success: true,
      data: servers,
    };
    res.json(response);
  } catch (error) {
    console.error('Error searching cloud market servers:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to search cloud market servers';
    res.status(500).json({
      success: false,
      message: errorMessage,
    });
  }
};

// Get cloud market servers by category
export const getCloudServersByCategory = async (req: Request, res: Response): Promise<void> => {
  try {
    const { category } = req.params;
    if (!category) {
      res.status(400).json({
        success: false,
        message: 'Category is required',
      });
      return;
    }

    const servers = await filterCloudServersByCategory(category);
    const response: ApiResponse<CloudServer[]> = {
      success: true,
      data: servers,
    };
    res.json(response);
  } catch (error) {
    console.error('Error getting cloud market servers by category:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to get cloud market servers by category';
    res.status(500).json({
      success: false,
      message: errorMessage,
    });
  }
};

// Get cloud market servers by tag
export const getCloudServersByTag = async (req: Request, res: Response): Promise<void> => {
  try {
    const { tag } = req.params;
    if (!tag) {
      res.status(400).json({
        success: false,
        message: 'Tag is required',
      });
      return;
    }

    const servers = await filterCloudServersByTag(tag);
    const response: ApiResponse<CloudServer[]> = {
      success: true,
      data: servers,
    };
    res.json(response);
  } catch (error) {
    console.error('Error getting cloud market servers by tag:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to get cloud market servers by tag';
    res.status(500).json({
      success: false,
      message: errorMessage,
    });
  }
};

// Get tools for a specific cloud server
export const getCloudServerToolsList = async (req: Request, res: Response): Promise<void> => {
  try {
    // Decode URL-encoded parameter to handle slashes in server name
    const serverName = decodeURIComponent(req.params.serverName);
    if (!serverName) {
      res.status(400).json({
        success: false,
        message: 'Server name is required',
      });
      return;
    }

    const tools = await getCloudServerTools(serverName);
    const response: ApiResponse<CloudTool[]> = {
      success: true,
      data: tools,
    };
    res.json(response);
  } catch (error) {
    console.error('Error getting cloud server tools:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to get cloud server tools';
    res.status(500).json({
      success: false,
      message: errorMessage,
    });
  }
};

// Call a tool on a cloud server
export const callCloudTool = async (req: Request, res: Response): Promise<void> => {
  try {
    // Decode URL-encoded parameters to handle slashes in server/tool names
    const serverName = decodeURIComponent(req.params.serverName);
    const toolName = decodeURIComponent(req.params.toolName);
    const { arguments: args } = req.body;

    if (!serverName) {
      res.status(400).json({
        success: false,
        message: 'Server name is required',
      });
      return;
    }

    if (!toolName) {
      res.status(400).json({
        success: false,
        message: 'Tool name is required',
      });
      return;
    }

    const result = await callCloudServerTool(serverName, toolName, args || {});
    const response: ApiResponse = {
      success: true,
      data: result,
    };
    res.json(response);
  } catch (error) {
    console.error('Error calling cloud server tool:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to call cloud server tool';
    res.status(500).json({
      success: false,
      message: errorMessage,
    });
  }
};
