import { AsyncLocalStorage } from 'node:async_hooks';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export const metricsEnabled = (): boolean => process.env.ENABLE_METRICS === 'true';
export const metricsRegistry = new Registry();
const calls = new Counter({
  name: 'mcphub_tool_calls_total',
  help: 'Completed client tool calls, including failures before upstream execution.',
  labelNames: ['server', 'status'],
  registers: [metricsRegistry],
});
const duration = new Histogram({
  name: 'mcphub_tool_call_duration_seconds',
  help: 'Client tool call duration including credential preparation and retries.',
  labelNames: ['server'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60, 120],
  registers: [metricsRegistry],
});
export const serverGauge = new Gauge({
  name: 'mcphub_servers_total',
  help: 'Enabled shared server definitions by current status and transport type.',
  labelNames: ['status', 'type'],
  registers: [metricsRegistry],
});
export const sessionGauge = new Gauge({
  name: 'mcphub_active_sessions',
  help: 'Current stateful client transport sessions; excludes stateless HTTP requests.',
  registers: [metricsRegistry],
});
const callContext = new AsyncLocalStorage<{ server: string }>();

// Only resolved server names enter labels; arbitrary client input never does.
export const setMetricsServer = (server: string): void => {
  const context = callContext.getStore();
  if (context) context.server = server;
};

export const observeToolCall = async <T>(call: () => Promise<T>): Promise<T> => {
  if (!metricsEnabled()) return call();
  return callContext.run({ server: 'unknown' }, async () => {
    const started = performance.now();
    let status = 'error';
    try {
      const result = await call();
      status = (result as { isError?: boolean })?.isError ? 'error' : 'success';
      return result;
    } finally {
      const server = callContext.getStore()!.server;
      calls.inc({ server, status });
      duration.observe({ server }, (performance.now() - started) / 1000);
    }
  });
};
