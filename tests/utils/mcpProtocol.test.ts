import { resolveUpstreamProtocolMode } from '../../src/utils/mcpProtocol.js';

describe('upstream negotiation policy', () => {
  it('defaults Streamable HTTP to auto and honors the legacy escape hatch', () => {
    expect(resolveUpstreamProtocolMode({ type: 'streamable-http' })).toBe('auto');
    expect(
      resolveUpstreamProtocolMode({ type: 'streamable-http', protocolNegotiation: 'legacy' }),
    ).toBe('legacy');
  });
  it.each(['stdio', 'sse', 'openapi', undefined] as const)(
    'keeps %s legacy and rejects explicit auto',
    (type) => {
      expect(resolveUpstreamProtocolMode({ type })).toBe('legacy');
      expect(() => resolveUpstreamProtocolMode({ type, protocolNegotiation: 'auto' })).toThrow(
        /streamable-http/,
      );
    },
  );
  it('treats a nullable database override as the default', () => {
    expect(resolveUpstreamProtocolMode({ type: 'streamable-http', protocolNegotiation: null } as never)).toBe('auto');
  });
  it('preserves the legacy elicitation relay without advertising modern support', () => {
    expect(resolveUpstreamProtocolMode({ type: 'streamable-http' }, true)).toBe('legacy');
  });
});
