describe('runtime BASE_PATH configuration', () => {
  const originalBasePath = process.env.BASE_PATH;

  afterEach(() => {
    if (originalBasePath === undefined) {
      delete process.env.BASE_PATH;
    } else {
      process.env.BASE_PATH = originalBasePath;
    }
    jest.resetModules();
  });

  it('normalizes a trailing slash before routes are registered', async () => {
    process.env.BASE_PATH = '/mcphub/';

    const { default: config } = await import('../../src/config/index.js');

    expect(config.basePath).toBe('/mcphub');
  });
});
