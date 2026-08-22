import { createDevBasePathRedirectMiddleware } from '../../frontend/viteBasePath.js';

const runMiddleware = (basePath: string, url: string, accept = 'text/html') => {
  const response = {
    end: jest.fn(),
    setHeader: jest.fn(),
    statusCode: 0,
  };
  const next = jest.fn();

  createDevBasePathRedirectMiddleware(basePath)(
    { headers: { accept }, method: 'GET', url } as never,
    response as never,
    next,
  );

  return { next, response };
};

describe('createDevBasePathRedirectMiddleware', () => {
  it.each([
    ['/', '/mcphub/'],
    ['/login?next=%2Fdashboard', '/mcphub/login?next=%2Fdashboard'],
  ])('redirects %s to %s', (url, location) => {
    const { next, response } = runMiddleware('/mcphub', url);

    expect(response.statusCode).toBe(302);
    expect(response.setHeader).toHaveBeenCalledWith('Location', location);
    expect(response.end).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it.each(['/mcphub/', '/mcphub/login'])('passes through %s', (url) => {
    const { next, response } = runMiddleware('/mcphub', url);

    expect(next).toHaveBeenCalled();
    expect(response.end).not.toHaveBeenCalled();
  });

  it.each(['/api/auth/login', '/config', '/public-config'])(
    'does not redirect API or config request %s',
    (url) => {
      const { next, response } = runMiddleware('/mcphub', url);

      expect(next).toHaveBeenCalled();
      expect(response.end).not.toHaveBeenCalled();
    },
  );

  it('passes through non-HTML requests', () => {
    const { next, response } = runMiddleware('/mcphub', '/login', '*/*');

    expect(next).toHaveBeenCalled();
    expect(response.end).not.toHaveBeenCalled();
  });

  it('does not redirect when BASE_PATH is empty', () => {
    const { next, response } = runMiddleware('', '/login');

    expect(next).toHaveBeenCalled();
    expect(response.end).not.toHaveBeenCalled();
  });
});
