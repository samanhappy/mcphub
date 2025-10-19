import { Request, Response } from 'express';
import { ApiResponse } from '../types/index.js';

const REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io/v0.1';

/**
 * Get all MCP servers from the official registry
 * Proxies the request to avoid CORS issues in the frontend
 * Supports cursor-based pagination
 */
export const getAllRegistryServers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { cursor, limit, search } = req.query;

    // Build URL with query parameters
    const url = new URL(`${REGISTRY_BASE_URL}/servers`);
    if (cursor && typeof cursor === 'string') {
      url.searchParams.append('cursor', cursor);
    }
    if (limit && typeof limit === 'string') {
      const limitNum = parseInt(limit, 10);
      if (!isNaN(limitNum) && limitNum > 0) {
        url.searchParams.append('limit', limit);
      }
    }
    if (search && typeof search === 'string') {
      url.searchParams.append('search', search);
    }

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json, application/problem+json',
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    const apiResponse: ApiResponse<typeof data> = {
      success: true,
      data: data,
    };

    res.json(apiResponse);
  } catch (error) {
    console.error('Error fetching registry servers:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to fetch registry servers';
    res.status(500).json({
      success: false,
      message: errorMessage,
    });
  }
};

/**
 * Get all versions of a specific MCP server
 * Proxies the request to avoid CORS issues in the frontend
 */
export const getRegistryServerVersions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { serverName } = req.params;

    if (!serverName) {
      res.status(400).json({
        success: false,
        message: 'Server name is required',
      });
      return;
    }

    // URL encode the server name
    const encodedName = encodeURIComponent(serverName);
    const response = await fetch(`${REGISTRY_BASE_URL}/servers/${encodedName}/versions`, {
      headers: {
        Accept: 'application/json, application/problem+json',
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        res.status(404).json({
          success: false,
          message: 'Server not found',
        });
        return;
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    const apiResponse: ApiResponse<typeof data> = {
      success: true,
      data: data,
    };

    res.json(apiResponse);
  } catch (error) {
    console.error('Error fetching registry server versions:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to fetch registry server versions';
    res.status(500).json({
      success: false,
      message: errorMessage,
    });
  }
};

/**
 * Get a specific version of an MCP server
 * Proxies the request to avoid CORS issues in the frontend
 */
export const getRegistryServerVersion = async (req: Request, res: Response): Promise<void> => {
  try {
    const { serverName, version } = req.params;

    if (!serverName || !version) {
      res.status(400).json({
        success: false,
        message: 'Server name and version are required',
      });
      return;
    }

    // URL encode the server name and version
    const encodedName = encodeURIComponent(serverName);
    const encodedVersion = encodeURIComponent(version);
    const response = await fetch(
      `${REGISTRY_BASE_URL}/servers/${encodedName}/versions/${encodedVersion}`,
      {
        headers: {
          Accept: 'application/json, application/problem+json',
        },
      },
    );

    if (!response.ok) {
      if (response.status === 404) {
        res.status(404).json({
          success: false,
          message: 'Server version not found',
        });
        return;
      }
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    const apiResponse: ApiResponse<typeof data> = {
      success: true,
      data: data,
    };

    res.json(apiResponse);
  } catch (error) {
    console.error('Error fetching registry server version:', error);
    const errorMessage =
      error instanceof Error ? error.message : 'Failed to fetch registry server version';
    res.status(500).json({
      success: false,
      message: errorMessage,
    });
  }
};
