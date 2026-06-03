import { Request, Response } from 'express';
import { ApiResponse } from '../types/index.js';
import { getServerCosts, getGroupCosts } from '../services/contextCostService.js';

export const getServerCostsHandler = async (_req: Request, res: Response): Promise<void> => {
  try {
    const data = await getServerCosts();
    const response: ApiResponse = { success: true, data };
    res.json(response);
  } catch (error) {
    console.error('Failed to get server context footprint:', error);
    res.status(500).json({ success: false, message: 'Failed to get server context footprint' });
  }
};

export const getGroupCostsHandler = async (_req: Request, res: Response): Promise<void> => {
  try {
    const data = await getGroupCosts();
    const response: ApiResponse = { success: true, data };
    res.json(response);
  } catch (error) {
    console.error('Failed to get group context footprint:', error);
    res.status(500).json({ success: false, message: 'Failed to get group context footprint' });
  }
};
