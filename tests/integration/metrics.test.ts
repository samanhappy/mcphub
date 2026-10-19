import express from 'express';
import request from 'supertest';
import { metrics } from '../../src/controllers/metricsController.js';
import {
  metricsRegistry,
  observeToolCall,
  setMetricsServer,
} from '../../src/services/metricsService.js';
import { getMetricsServerSnapshot } from '../../src/services/mcpService.js';
import { transports } from '../../src/services/sseService.js';

jest.mock('../../src/services/mcpService.js', () => ({ getMetricsServerSnapshot: jest.fn() }));
jest.mock('../../src/services/sseService.js', () => ({ transports: {} }));

const app = express();
app.get('/metrics', metrics);
const previousEnabled = process.env.ENABLE_METRICS;
const previousToken = process.env.METRICS_TOKEN;

beforeEach(() => {
  process.env.ENABLE_METRICS = 'true';
  delete process.env.METRICS_TOKEN;
  metricsRegistry.resetMetrics();
  jest.mocked(getMetricsServerSnapshot).mockReturnValue([
    { status: 'connected', type: 'stdio' },
    { status: 'connected', type: 'stdio' },
    { status: 'oauth_required', type: 'openapi' },
  ]);
  for (const key of Object.keys(transports)) delete transports[key];
});
afterAll(() => {
  if (previousEnabled === undefined) delete process.env.ENABLE_METRICS;
  else process.env.ENABLE_METRICS = previousEnabled;
  if (previousToken === undefined) delete process.env.METRICS_TOKEN;
  else process.env.METRICS_TOKEN = previousToken;
});

test('disabled by default and independently protected by scrape token', async () => {
  delete process.env.ENABLE_METRICS;
  await request(app).get('/metrics').expect(404);
  process.env.ENABLE_METRICS = 'true';
  process.env.METRICS_TOKEN = 'scrape-secret';
  await request(app).get('/metrics').expect(401);
  await request(app).get('/metrics').set('Authorization', 'Bearer wrong').expect(401);
  const response = await request(app)
    .get('/metrics')
    .set('Authorization', 'Bearer scrape-secret')
    .expect(200);
  expect(response.headers['content-type']).toContain('text/plain');
  expect(response.text).not.toContain('scrape-secret');
});

test('collects live gauges without accumulating across scrapes', async () => {
  transports.test = { group: 'private-group' } as any;
  const response = await request(app).get('/metrics').expect(200);
  expect(response.text).toContain('mcphub_servers_total{status="connected",type="stdio"} 2');
  expect(response.text).toContain('mcphub_servers_total{status="oauth_required",type="openapi"} 1');
  expect(response.text).toContain('mcphub_active_sessions 1');
  expect(response.text).not.toContain('private-group');
  delete transports.test;
  jest.mocked(getMetricsServerSnapshot).mockReturnValue([]);
  const next = await request(app).get('/metrics');
  expect(next.text).not.toContain('status="connected"');
  expect(next.text).toContain('mcphub_active_sessions 0');
});

test('counts final outcomes once, including returned errors and thrown preparation failures', async () => {
  await observeToolCall(async () => {
    setMetricsServer('upstream');
    // Internal retries remain inside a single observation.
    for (let attempt = 0; attempt < 3; attempt++) await Promise.resolve();
    return { content: [] };
  });
  await observeToolCall(async () => {
    setMetricsServer('upstream');
    return { isError: true };
  });
  await expect(
    observeToolCall(async () => {
      throw new Error('private error');
    }),
  ).rejects.toThrow('private error');
  const response = await request(app).get('/metrics');
  expect(response.text).toContain('mcphub_tool_calls_total{server="upstream",status="success"} 1');
  expect(response.text).toContain('mcphub_tool_calls_total{server="upstream",status="error"} 1');
  expect(response.text).toContain('mcphub_tool_calls_total{server="unknown",status="error"} 1');
  expect(response.text).toContain('mcphub_tool_call_duration_seconds_count{server="upstream"} 2');
  expect(response.text).not.toContain('private error');
});

test('disabled instrumentation is inert and concurrent calls retain their server', async () => {
  delete process.env.ENABLE_METRICS;
  await observeToolCall(async () => ({ isError: true }));
  process.env.ENABLE_METRICS = 'true';
  await Promise.all(
    ['one', 'two'].map((server) =>
      observeToolCall(async () => {
        setMetricsServer(server);
        await new Promise((resolve) => setImmediate(resolve));
        return {};
      }),
    ),
  );
  const response = await request(app).get('/metrics');
  expect(response.text).not.toContain('server="unknown"');
  for (const server of ['one', 'two']) {
    expect(response.text).toContain(
      `mcphub_tool_calls_total{server="${server}",status="success"} 1`,
    );
  }
});
