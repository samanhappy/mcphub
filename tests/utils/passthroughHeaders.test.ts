import { isSafePassthroughHeader } from '../../src/utils/passthroughHeaders.js';
import { getCachedSystemConfig } from '../../src/utils/systemConfigCache.js';
import { isHostedModeEnabled } from '../../src/services/hostedMode.js';

jest.mock('../../src/utils/systemConfigCache.js', () => ({ getCachedSystemConfig: jest.fn() }));
jest.mock('../../src/services/hostedMode.js', () => ({ isHostedModeEnabled: jest.fn() }));

describe('Authorization passthrough policy', () => {
  beforeEach(() => {
    jest.mocked(isHostedModeEnabled).mockReturnValue(false);
    jest.mocked(getCachedSystemConfig).mockReturnValue({
      routing: { bearerAuthHeaderName: 'X-Hub-Key', allowAuthorizationPassthrough: true },
    });
  });

  it.each(['Authorization', 'AUTHORIZATION', ' authorization '])(
    'allows explicit opt-in for %s',
    (name) => {
      expect(isSafePassthroughHeader(name)).toBe(true);
    },
  );

  it.each([undefined, false])('denies Authorization without opt-in: %s', (enabled) => {
    jest.mocked(getCachedSystemConfig).mockReturnValue({
      routing: { bearerAuthHeaderName: 'X-Hub-Key', allowAuthorizationPassthrough: enabled },
    });
    expect(isSafePassthroughHeader('Authorization')).toBe(false);
  });

  it.each([undefined, '', 'Authorization', 'aUtHoRiZaTiOn'])(
    'never forwards the platform auth header: %s',
    (name) => {
      jest.mocked(getCachedSystemConfig).mockReturnValue({
        routing: { bearerAuthHeaderName: name, allowAuthorizationPassthrough: true },
      });
      expect(isSafePassthroughHeader('Authorization')).toBe(false);
    },
  );

  it('denies Authorization in hosted mode even with a custom header and opt-in', () => {
    jest.mocked(isHostedModeEnabled).mockReturnValue(true);
    expect(isSafePassthroughHeader('Authorization')).toBe(false);
  });

  it.each(['X-Hub-Key', 'Cookie', 'Proxy-Authorization', 'X-Auth-Token', 'X-Api-Key', ' '])(
    'still blocks %s with opt-in',
    (name) => {
      expect(isSafePassthroughHeader(name)).toBe(false);
    },
  );
});
