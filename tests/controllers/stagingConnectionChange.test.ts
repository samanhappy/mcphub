import type { ServerConfig } from '../../src/types/index.js';
import { hasConnectionRelevantChange } from '../../src/utils/connectionRelevantConfig.js';

const base = (): ServerConfig =>
  ({
    id: '0f1d3d3c-1111-4111-8111-111111111111',
    type: 'stdio',
    command: 'npx',
    args: ['-y', '@fangjunjie/ssh-mcp-server@1.11.0'],
    visibility: 'private',
    owner: 'admin',
    staging: { adapter: 'ssh' },
    tools: {
      upload: { enabled: true, fileStaging: { enabled: false, inputParams: ['localPath'] } },
    },
  }) as ServerConfig;

describe('staging and connection-relevant config changes (#1056)', () => {
  it('treats a description edit as a read-time change', () => {
    const next = { ...base(), description: 'changed' } as ServerConfig;
    expect(hasConnectionRelevantChange(base() as never, next)).toBe(false);
  });

  it('reconnects when the first staged tool is enabled on a staging server', () => {
    const next = base();
    next.tools = {
      upload: { enabled: true, fileStaging: { enabled: true, inputParams: ['localPath'] } },
    };
    // The child must restart in the principal's staging root; the server-level
    // `staging` field is unchanged, so the derived state has to count.
    expect(hasConnectionRelevantChange(base() as never, next)).toBe(true);
  });

  it('does not reconnect for an unrelated tool metadata edit', () => {
    const next = base();
    next.tools = {
      upload: { enabled: true, description: 'Upload a file' },
    };
    expect(hasConnectionRelevantChange(base() as never, next)).toBe(false);
  });
});
