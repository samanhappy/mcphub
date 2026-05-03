import { resolveTrustProxySetting } from '../../src/utils/proxyTrust.js';

describe('resolveTrustProxySetting', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.TRUST_PROXY;
    delete process.env.KUBERNETES_SERVICE_HOST;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns false by default outside container environments', () => {
    expect(resolveTrustProxySetting(process.env, () => false)).toBe(false);
  });

  it('trusts a single proxy by default inside Docker-like environments', () => {
    expect(resolveTrustProxySetting(process.env, () => true)).toBe(1);
  });

  it('trusts a single proxy by default inside Kubernetes environments', () => {
    process.env.KUBERNETES_SERVICE_HOST = '10.96.0.1';

    expect(resolveTrustProxySetting(process.env, () => false)).toBe(1);
  });

  it('allows explicitly disabling trust proxy', () => {
    process.env.TRUST_PROXY = 'false';

    expect(resolveTrustProxySetting(process.env, () => true)).toBe(false);
  });

  it('parses numeric trust proxy hop counts', () => {
    process.env.TRUST_PROXY = '2';

    expect(resolveTrustProxySetting(process.env, () => false)).toBe(2);
  });

  it('passes through named proxy presets', () => {
    process.env.TRUST_PROXY = 'loopback, linklocal, uniquelocal';

    expect(resolveTrustProxySetting(process.env, () => false)).toBe(
      'loopback, linklocal, uniquelocal',
    );
  });
});
