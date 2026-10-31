import { timingSafeEqual } from 'node:crypto';
import { isReplicaMode } from '../utils/replicaMode.js';
import { replicaStatus } from '../services/replicaService.js';
import type { Request, Response } from 'express';
import { getMetricsServerSnapshot } from '../services/mcpService.js';
import { transports } from '../services/sseService.js';
import {
  metricsEnabled,
  metricsRegistry,
  serverGauge,
  sessionGauge,
  configurationVersionGauge,
} from '../services/metricsService.js';

export const metrics = async (req: Request, res: Response): Promise<void> => {
  if (!metricsEnabled()) {
    res.sendStatus(404);
    return;
  }
  const token = process.env.METRICS_TOKEN;
  if (token) {
    const expected = Buffer.from(`Bearer ${token}`);
    const actual = Buffer.from(req.get('authorization') || '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      res.sendStatus(401);
      return;
    }
  }
  try {
    if (isReplicaMode()) {
      const state = replicaStatus();
      metricsRegistry.setDefaultLabels({ node: state.nodeId });
      configurationVersionGauge.set({ state: 'desired' }, Number(state.desiredVersion ?? 0));
      configurationVersionGauge.set({ state: 'applied' }, Number(state.appliedVersion ?? 0));
    }
    serverGauge.reset();
    for (const server of getMetricsServerSnapshot()) {
      serverGauge.inc({ status: server.status, type: server.type });
    }
    sessionGauge.set(Object.keys(transports).length);
    res.set('Cache-Control', 'no-store');
    res.set('Content-Type', metricsRegistry.contentType);
    res.send(await metricsRegistry.metrics());
  } catch {
    res.sendStatus(500);
  }
};
