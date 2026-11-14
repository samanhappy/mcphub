import { randomUUID } from 'node:crypto';

// Advertised through MCP capabilities so another MCPHub process can tell this
// exact instance apart from a different hub that happens to share the product
// name and version. The value is deliberately process-local: a restart creates
// a new identity, which is sufficient because its upstream connections are
// re-initialized as well.
export const MCPHUB_INSTANCE_CAPABILITY_ID = 'io.mcphub/instance';
export const MCPHUB_INSTANCE_ID = randomUUID();

export const MCPHUB_INSTANCE_CAPABILITIES = {
  experimental: {
    [MCPHUB_INSTANCE_CAPABILITY_ID]: { id: MCPHUB_INSTANCE_ID },
  },
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export const getMcpHubInstanceId = (capabilities: unknown): string | undefined => {
  const experimental = asRecord(asRecord(capabilities)?.experimental);
  const instance = asRecord(experimental?.[MCPHUB_INSTANCE_CAPABILITY_ID]);
  return typeof instance?.id === 'string' ? instance.id : undefined;
};

export const isThisMcpHubInstance = (capabilities: unknown): boolean =>
  getMcpHubInstanceId(capabilities) === MCPHUB_INSTANCE_ID;
