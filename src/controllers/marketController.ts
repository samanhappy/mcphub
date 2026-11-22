import { Request, Response } from 'express';
import { ApiResponse } from '../types/index.js';
import {
  getMarketServers,
  getMarketServerByName,
  getMarketCategories,
  getMarketTags,
  searchMarketServers,
  filterMarketServersByCategory,
  filterMarketServersByTag,
} from '../services/marketService.js';

const HOSTED_REGISTRY_URL = 'https://www.mcphub.app/api/v1/registry/';
const REGISTRY_SLUG = /^[a-z\d][a-z\d._-]{0,127}$/i;

// Dashboard preview. Keep upstream requests on the public Registry API origin.
export const getHostedMarketCatalog = async (req: Request, res: Response): Promise<void> => {
  const { author, name } = req.params;
  const isDetail = author !== undefined || name !== undefined;
  if (isDetail && ![author, name].every((slug) => REGISTRY_SLUG.test(slug ?? ''))) {
    res.status(400).json({ success: false, message: 'Invalid Registry server identity' });
    return;
  }

  const path = isDetail
    ? `servers/${encodeURIComponent(author)}/${encodeURIComponent(name)}`
    : /\/featured\/?$/i.test(req.path)
      ? 'featured'
      : /\/categories\/?$/i.test(req.path) ? 'categories' : 'servers';
  const url = new URL(path, HOSTED_REGISTRY_URL);
  if (path === 'servers') {
    for (const key of ['q', 'category', 'transport', 'page', 'pageSize']) {
      const value = req.query[key];
      if (typeof value === 'string') url.searchParams.set(key, value.slice(0, 128));
    }
  }

  try {
    const upstream = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(8_000) });
    if (isDetail && upstream.status === 404) {
      res.status(404).json({ success: false, message: 'Registry server not found' });
      return;
    }
    if (!upstream.ok) throw new Error(`Registry response ${upstream.status}`);
    const payload = await upstream.json() as ApiResponse<unknown>;
    if (payload?.success !== true || payload.data == null) throw new Error('Invalid Registry response');
    res.json(payload);
  } catch {
    res.status(502).json({ success: false, message: 'MCPHub Registry unavailable' });
  }
};

// Get all market servers
export const getAllMarketServers = (_: Request, res: Response): void => {
  try {
    const marketServers = Object.values(getMarketServers());
    const response: ApiResponse = {
      success: true,
      data: marketServers,
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get market servers information',
    });
  }
};

// Get a specific market server by name
export const getMarketServer = (req: Request, res: Response): void => {
  try {
    const { name } = req.params;
    if (!name) {
      res.status(400).json({
        success: false,
        message: 'Server name is required',
      });
      return;
    }

    const server = getMarketServerByName(name);
    if (!server) {
      res.status(404).json({
        success: false,
        message: 'Market server not found',
      });
      return;
    }

    const response: ApiResponse = {
      success: true,
      data: server,
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get market server information',
    });
  }
};

// Get all market categories
export const getAllMarketCategories = (_: Request, res: Response): void => {
  try {
    const categories = getMarketCategories();
    const response: ApiResponse = {
      success: true,
      data: categories,
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get market categories',
    });
  }
};

// Get all market tags
export const getAllMarketTags = (_: Request, res: Response): void => {
  try {
    const tags = getMarketTags();
    const response: ApiResponse = {
      success: true,
      data: tags,
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to get market tags',
    });
  }
};

// Search market servers
export const searchMarketServersByQuery = (req: Request, res: Response): void => {
  try {
    const { query } = req.query;
    const searchQuery = typeof query === 'string' ? query : '';

    const servers = searchMarketServers(searchQuery);
    const response: ApiResponse = {
      success: true,
      data: servers,
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to search market servers',
    });
  }
};

// Filter market servers by category
export const getMarketServersByCategory = (req: Request, res: Response): void => {
  try {
    const { category } = req.params;

    const servers = filterMarketServersByCategory(category);
    const response: ApiResponse = {
      success: true,
      data: servers,
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to filter market servers by category',
    });
  }
};

// Filter market servers by tag
export const getMarketServersByTag = (req: Request, res: Response): void => {
  try {
    const { tag } = req.params;

    const servers = filterMarketServersByTag(tag);
    const response: ApiResponse = {
      success: true,
      data: servers,
    };
    res.json(response);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Failed to filter market servers by tag',
    });
  }
};
