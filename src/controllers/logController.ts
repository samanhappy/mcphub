// filepath: /Users/sunmeng/code/github/mcphub/src/controllers/logController.ts
import { Request, Response } from 'express';
import logService from '../services/logService.js';
import { logger } from '../utils/logger.js';

// Get all logs
export const getAllLogs = (req: Request, res: Response): void => {
  try {
    const logs = logService.getLogs();
    res.json({ success: true, data: logs });
  } catch (error) {
    logger.error('Error getting logs:', error);
    res.status(500).json({ success: false, error: 'Error getting logs' });
  }
};

// Clear all logs
export const clearLogs = (req: Request, res: Response): void => {
  try {
    logService.clearLogs();
    res.json({ success: true, message: 'Logs cleared successfully' });
  } catch (error) {
    logger.error('Error clearing logs:', error);
    res.status(500).json({ success: false, error: 'Error clearing logs' });
  }
};

// Stream logs via SSE
export const streamLogs = (req: Request, res: Response): void => {
  try {
    // Set headers for SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Send initial data
    const logs = logService.getLogs();
    res.write(`data: ${JSON.stringify({ type: 'initial', logs })}\n\n`);

    // Subscribe to log and auxiliary stream events
    const unsubscribe = logService.subscribeToStream((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });

    // Handle client disconnect
    req.on('close', () => {
      unsubscribe();
      logger.log('Client disconnected from log stream');
    });
  } catch (error) {
    logger.error('Error streaming logs:', error);
    res.status(500).json({ success: false, error: 'Error streaming logs' });
  }
};
