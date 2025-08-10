import { Request, Response } from 'express';
import { connected } from '../services/mcpService.js';

/**
 * Health check endpoint
 * Returns 200 OK when all MCPs are loaded and connected
 * Returns 503 Service Unavailable when MCPs are not ready
 */
export const healthCheck = (_req: Request, res: Response): void => {
  try {
    const allConnected = connected();
    if (allConnected) {
      res.status(200).json({
        status: 'healthy',
        message: 'All enabled MCP servers are ready',
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(503).json({
        status: 'unhealthy',
        message: 'Not all enabled MCP servers are ready',
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error('Health check error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error during health check',
      timestamp: new Date().toISOString(),
    });
  }
};
