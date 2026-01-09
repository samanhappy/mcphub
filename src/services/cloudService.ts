import axios, { AxiosRequestConfig } from 'axios';
import {
  CloudServer,
  CloudTool,
  MCPRouterResponse,
  MCPRouterListServersResponse,
  MCPRouterListToolsResponse,
  MCPRouterCallToolResponse,
} from '../types/index.js';
import { getSystemConfigDao } from '../dao/index.js';
// MCPRouter API default base URL
const DEFAULT_MCPROUTER_API_BASE = 'https://api.mcprouter.to/v1';

// Get MCPRouter API config from system configuration
const getMCPRouterConfig = async () => {
  const systemConfigDao = getSystemConfigDao();
  const systemConfig = await systemConfigDao.get();
  const mcpRouterConfig = systemConfig?.mcpRouter;

  return {
    apiKey: mcpRouterConfig?.apiKey || process.env.MCPROUTER_API_KEY || '',
    referer: mcpRouterConfig?.referer || process.env.MCPROUTER_REFERER || 'https://www.mcphubx.com',
    title: mcpRouterConfig?.title || process.env.MCPROUTER_TITLE || 'MCPHub',
    baseUrl:
      mcpRouterConfig?.baseUrl || process.env.MCPROUTER_API_BASE || DEFAULT_MCPROUTER_API_BASE,
  };
};

// Get axios config with MCPRouter headers
const getAxiosConfig = async (): Promise<AxiosRequestConfig> => {
  const mcpRouterConfig = await getMCPRouterConfig();

  return {
    headers: {
      Authorization: mcpRouterConfig.apiKey ? `Bearer ${mcpRouterConfig.apiKey}` : '',
      'HTTP-Referer': mcpRouterConfig.referer || 'https://www.mcphubx.com',
      'X-Title': mcpRouterConfig.title || 'MCPHub',
      'Content-Type': 'application/json',
    },
  };
};

// List all available cloud servers
export const getCloudServers = async (): Promise<CloudServer[]> => {
  try {
    const axiosConfig = await getAxiosConfig();
    const mcpRouterConfig = await getMCPRouterConfig();

    const response = await axios.post<MCPRouterResponse<MCPRouterListServersResponse>>(
      `${mcpRouterConfig.baseUrl}/list-servers`,
      {},
      axiosConfig,
    );

    const data = response.data;

    if (data.code !== 0) {
      throw new Error(data.message || 'Failed to fetch servers');
    }

    return data.data.servers || [];
  } catch (error) {
    console.error('Error fetching cloud market servers:', error);
    throw error;
  }
};

// Get a specific cloud server by name
export const getCloudServerByName = async (name: string): Promise<CloudServer | null> => {
  try {
    const servers = await getCloudServers();
    return servers.find((server) => server.name === name || server.config_name === name) || null;
  } catch (error) {
    console.error(`Error fetching cloud server ${name}:`, error);
    throw error;
  }
};

// List tools for a specific cloud server
export const getCloudServerTools = async (serverKey: string): Promise<CloudTool[]> => {
  try {
    const axiosConfig = await getAxiosConfig();
    const mcpRouterConfig = await getMCPRouterConfig();

    if (
      !axiosConfig.headers?.['Authorization'] ||
      axiosConfig.headers['Authorization'] === 'Bearer '
    ) {
      throw new Error('MCPROUTER_API_KEY_NOT_CONFIGURED');
    }

    const response = await axios.post<MCPRouterResponse<MCPRouterListToolsResponse>>(
      `${mcpRouterConfig.baseUrl}/list-tools`,
      {
        server: serverKey,
      },
      axiosConfig,
    );

    const data = response.data;
    if (data.code !== 0) {
      throw new Error(data.message || 'Failed to fetch tools');
    }

    return data.data.tools || [];
  } catch (error) {
    console.error(`Error fetching tools for server ${serverKey}:`, error);
    throw error;
  }
};

// Call a tool on a cloud server
export const callCloudServerTool = async (
  serverName: string,
  toolName: string,
  args: Record<string, any>,
): Promise<MCPRouterCallToolResponse> => {
  try {
    const axiosConfig = await getAxiosConfig();
    const mcpRouterConfig = await getMCPRouterConfig();

    if (
      !axiosConfig.headers?.['Authorization'] ||
      axiosConfig.headers['Authorization'] === 'Bearer '
    ) {
      throw new Error('MCPROUTER_API_KEY_NOT_CONFIGURED');
    }

    const response = await axios.post<MCPRouterResponse<MCPRouterCallToolResponse>>(
      `${mcpRouterConfig.baseUrl}/call-tool`,
      {
        server: serverName,
        name: toolName,
        arguments: args,
      },
      axiosConfig,
    );

    const data = response.data;

    if (data.code !== 0) {
      throw new Error(data.message || 'Failed to call tool');
    }

    return data.data;
  } catch (error) {
    console.error(`Error calling tool ${toolName} on server ${serverName}:`, error);
    throw error;
  }
};

// Get all categories from cloud servers
export const getCloudCategories = async (): Promise<string[]> => {
  try {
    const servers = await getCloudServers();
    const categories = new Set<string>();

    servers.forEach((server) => {
      // Extract categories from content or description
      // This is a simple implementation, you might want to parse the content more sophisticatedly
      if (server.content) {
        const categoryMatches = server.content.match(/category[:\s]*([^,\n]+)/gi);
        if (categoryMatches) {
          categoryMatches.forEach((match) => {
            const category = match.replace(/category[:\s]*/i, '').trim();
            if (category) categories.add(category);
          });
        }
      }
    });

    return Array.from(categories).sort();
  } catch (error) {
    console.error('Error fetching cloud market categories:', error);
    throw error;
  }
};

// Get all tags from cloud servers
export const getCloudTags = async (): Promise<string[]> => {
  try {
    const servers = await getCloudServers();
    const tags = new Set<string>();

    servers.forEach((server) => {
      // Extract tags from content or description
      if (server.content) {
        const tagMatches = server.content.match(/tag[s]?[:\s]*([^,\n]+)/gi);
        if (tagMatches) {
          tagMatches.forEach((match) => {
            const tag = match.replace(/tag[s]?[:\s]*/i, '').trim();
            if (tag) tags.add(tag);
          });
        }
      }
    });

    return Array.from(tags).sort();
  } catch (error) {
    console.error('Error fetching cloud market tags:', error);
    throw error;
  }
};

// Search cloud servers by query
export const searchCloudServers = async (query: string): Promise<CloudServer[]> => {
  try {
    const servers = await getCloudServers();
    const searchTerms = query
      .toLowerCase()
      .split(' ')
      .filter((term) => term.length > 0);

    if (searchTerms.length === 0) {
      return servers;
    }

    return servers.filter((server) => {
      const searchText = [
        server.name,
        server.title,
        server.description,
        server.content,
        server.author_name,
      ]
        .join(' ')
        .toLowerCase();

      return searchTerms.some((term) => searchText.includes(term));
    });
  } catch (error) {
    console.error('Error searching cloud market servers:', error);
    throw error;
  }
};

// Filter cloud servers by category
export const filterCloudServersByCategory = async (category: string): Promise<CloudServer[]> => {
  try {
    const servers = await getCloudServers();

    if (!category) {
      return servers;
    }

    return servers.filter((server) => {
      const content = (server.content || '').toLowerCase();
      return content.includes(category.toLowerCase());
    });
  } catch (error) {
    console.error('Error filtering cloud market servers by category:', error);
    throw error;
  }
};

// Filter cloud servers by tag
export const filterCloudServersByTag = async (tag: string): Promise<CloudServer[]> => {
  try {
    const servers = await getCloudServers();

    if (!tag) {
      return servers;
    }

    return servers.filter((server) => {
      const content = (server.content || '').toLowerCase();
      return content.includes(tag.toLowerCase());
    });
  } catch (error) {
    console.error('Error filtering cloud market servers by tag:', error);
    throw error;
  }
};
