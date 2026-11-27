import {
  classifyPasskeyAvailability,
  isIpAddressHost,
} from '../../frontend/src/utils/passkeyAvailability.js';

describe('passkey availability', () => {
  it('is available on a secure page opened by a domain name', () => {
    expect(
      classifyPasskeyAvailability({
        isSecureContext: true,
        hostname: 'hub.example.test',
        webAuthnSupported: true,
      }),
    ).toBe('available');
    expect(
      classifyPasskeyAvailability({
        isSecureContext: true,
        hostname: 'localhost',
        webAuthnSupported: true,
      }),
    ).toBe('available');
  });

  it('reports an insecure context instead of an unsupported browser on plain HTTP', () => {
    // Browsers hide WebAuthn outside secure contexts, so support detection fails too.
    expect(
      classifyPasskeyAvailability({
        isSecureContext: false,
        hostname: '100.102.254.35',
        webAuthnSupported: false,
      }),
    ).toBe('insecureContext');
    expect(
      classifyPasskeyAvailability({
        isSecureContext: false,
        hostname: 'hub.lan',
        webAuthnSupported: false,
      }),
    ).toBe('insecureContext');
  });

  it('reports an insecure context for IP addresses even over HTTPS', () => {
    for (const hostname of ['192.168.1.10', '127.0.0.1', '[::1]']) {
      expect(
        classifyPasskeyAvailability({ isSecureContext: true, hostname, webAuthnSupported: true }),
      ).toBe('insecureContext');
    }
  });

  it('reports an unsupported browser only on a qualifying page', () => {
    expect(
      classifyPasskeyAvailability({
        isSecureContext: true,
        hostname: 'hub.example.test',
        webAuthnSupported: false,
      }),
    ).toBe('unsupported');
  });

  it('recognises IP literals but not numeric-looking host names', () => {
    expect(isIpAddressHost('10.0.0.5')).toBe(true);
    expect(isIpAddressHost('[2001:db8::1]')).toBe(true);
    expect(isIpAddressHost('1.2.3.4.nip.io')).toBe(false);
    expect(isIpAddressHost('localhost')).toBe(false);
  });
});
