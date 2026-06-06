const mockGet = jest.fn();

jest.mock('../../src/dao/DaoFactory.js', () => ({
  getSystemConfigDao: jest.fn(() => ({
    get: mockGet,
  })),
}));

import { getSmartRoutingConfig } from '../../src/utils/smartRouting.js';

describe('getSmartRoutingConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv };
    delete process.env.SMART_ROUTING_SERVER_DESCRIPTION_MODE;
    mockGet.mockResolvedValue({ smartRouting: {} });
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('defaults serverDescriptionMode to names', async () => {
    const config = await getSmartRoutingConfig();

    expect(config.serverDescriptionMode).toBe('names');
  });

  it('accepts full serverDescriptionMode from environment', async () => {
    process.env.SMART_ROUTING_SERVER_DESCRIPTION_MODE = 'full';

    const config = await getSmartRoutingConfig();

    expect(config.serverDescriptionMode).toBe('full');
  });

  it('falls back to names for invalid serverDescriptionMode values', async () => {
    process.env.SMART_ROUTING_SERVER_DESCRIPTION_MODE = 'verbose';

    const config = await getSmartRoutingConfig();

    expect(config.serverDescriptionMode).toBe('names');
  });
});
