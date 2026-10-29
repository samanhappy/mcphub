import type { Server } from '../types';

// Ignore transient polling metadata, but include full definitions: equal tool
// counts do not imply equal context costs.
export const serverCostRevision = (servers: Server[]): string =>
  JSON.stringify(
    servers.map(({ name, status, enabled, tools, prompts, resources }) => ({
      name,
      status,
      enabled,
      tools,
      prompts,
      resources,
    })),
  );
