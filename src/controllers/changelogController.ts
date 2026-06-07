import { Request, Response } from 'express';
import config from '../config/index.js';
import { getChangelogUpdateInfo } from '../services/changelogService.js';

export const getChangelogUpdateInfoHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  try {
    const locale = typeof req.query.locale === 'string' ? req.query.locale : undefined;
    const force = req.query.force === 'true';
    const currentVersion =
      typeof req.query.currentVersion === 'string' ? req.query.currentVersion : config.mcpHubVersion;

    const data = await getChangelogUpdateInfo({
      currentVersion,
      locale,
      force,
    });

    res.json({
      success: true,
      data,
    });
  } catch (error) {
    console.error('Error fetching changelog update info:', error);
    res.status(500).json({
      success: false,
      message:
        error instanceof Error ? error.message : 'Failed to fetch changelog update information',
    });
  }
};

