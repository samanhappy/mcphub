import { isPrivilegedServerConfig } from '../../src/utils/serverConfigValidation.js';
import { ServerConfig } from '../../src/types/index.js';

const config = (partial: Partial<ServerConfig>): ServerConfig => partial as ServerConfig;

describe('isPrivilegedServerConfig', () => {
  it('flags explicit stdio type', () => {
    expect(isPrivilegedServerConfig(config({ type: 'stdio', url: 'http://x' }))).toBe(true);
  });

  it('flags command-carrying configs even without a stdio type', () => {
    expect(isPrivilegedServerConfig(config({ command: 'npx' }))).toBe(true);
    expect(isPrivilegedServerConfig(config({ args: ['-y', 'mcp-server'] }))).toBe(true);
  });

  it('flags configs without any remote target (implicit stdio shape)', () => {
    expect(isPrivilegedServerConfig(config({}))).toBe(true);
  });

  it('allows url-based servers without command or stdio type', () => {
    expect(isPrivilegedServerConfig(config({ url: 'http://example.com/sse' }))).toBe(false);
    expect(isPrivilegedServerConfig(config({ type: 'sse', url: 'http://x' }))).toBe(false);
    expect(isPrivilegedServerConfig(config({ type: 'streamable-http', url: 'http://x' }))).toBe(
      false,
    );
  });

  it('allows OpenAPI servers backed by url or inline schema', () => {
    expect(isPrivilegedServerConfig(config({ openapi: { url: 'https://x/openapi.json' } }))).toBe(
      false,
    );
    expect(isPrivilegedServerConfig(config({ openapi: { schema: { openapi: '3.1.0' } } }))).toBe(
      false,
    );
  });
});
