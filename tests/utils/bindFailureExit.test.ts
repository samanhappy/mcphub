import { exitAfterBindFailure } from '../../src/utils/bindFailureExit.js';

const bindError = (code: string): NodeJS.ErrnoException => Object.assign(new Error(code), { code });

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: Error) => void;
};

const deferred = <T>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (err: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('exitAfterBindFailure', () => {
  let consoleError: jest.SpyInstance;
  let consoleWarn: jest.SpyInstance;

  beforeEach(() => {
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    consoleWarn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The regression this guards: process.exit(1) used to run while the upstream
  // terminations were still in flight, which cancelled them (issue raised on
  // the MCPHUB_HOST pull request).
  it('exits only after the upstream terminations have settled', async () => {
    const drain = deferred<boolean>();
    const exit = jest.fn();
    const cleanupUpstreamServers = jest.fn();

    const finished = exitAfterBindFailure({
      error: bindError('EADDRINUSE'),
      host: '127.0.0.1',
      port: 3000,
      cleanupUpstreamServers,
      drainUpstreamTerminations: () => drain.promise,
      budgetMs: 3000,
      exit,
    });

    await Promise.resolve();
    expect(cleanupUpstreamServers).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled();

    drain.resolve(true);
    await finished;

    expect(exit).toHaveBeenCalledWith(1);
    expect(consoleWarn).not.toHaveBeenCalled();
  });

  it('starts the cleanup before it waits for it', async () => {
    const calls: string[] = [];

    await exitAfterBindFailure({
      error: bindError('EADDRNOTAVAIL'),
      host: '192.0.2.1',
      port: 3000,
      cleanupUpstreamServers: () => calls.push('cleanup'),
      drainUpstreamTerminations: async () => {
        calls.push('drain');
        return true;
      },
      budgetMs: 3000,
      exit: () => calls.push('exit'),
    });

    expect(calls).toEqual(['cleanup', 'drain', 'exit']);
  });

  it('passes the budget to the wait and exits anyway when it runs out', async () => {
    const drainUpstreamTerminations = jest.fn().mockResolvedValue(false);
    const exit = jest.fn();

    await exitAfterBindFailure({
      error: bindError('EADDRINUSE'),
      host: '127.0.0.1',
      port: 3000,
      cleanupUpstreamServers: jest.fn(),
      drainUpstreamTerminations,
      budgetMs: 3000,
      exit,
    });

    expect(drainUpstreamTerminations).toHaveBeenCalledWith(3000);
    expect(exit).toHaveBeenCalledWith(1);
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining('did not settle within 3000 ms'),
    );
  });

  it('exits anyway when the wait itself fails', async () => {
    const exit = jest.fn();

    await exitAfterBindFailure({
      error: bindError('EADDRINUSE'),
      host: '127.0.0.1',
      port: 3000,
      cleanupUpstreamServers: jest.fn(),
      drainUpstreamTerminations: () => Promise.reject(new Error('drain blew up')),
      budgetMs: 3000,
      exit,
    });

    expect(exit).toHaveBeenCalledWith(1);
    expect(consoleWarn).toHaveBeenCalledWith(
      expect.stringContaining('Waiting for upstream stdio cleanup failed'),
      expect.anything(),
    );
  });

  it('still waits and exits when the cleanup throws', async () => {
    const drainUpstreamTerminations = jest.fn().mockResolvedValue(true);
    const exit = jest.fn();

    await exitAfterBindFailure({
      error: bindError('EADDRINUSE'),
      host: '127.0.0.1',
      port: 3000,
      cleanupUpstreamServers: () => {
        throw new Error('cleanup blew up');
      },
      drainUpstreamTerminations,
      budgetMs: 3000,
      exit,
    });

    expect(drainUpstreamTerminations).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('names the requested address and the error code in the fatal log line', async () => {
    await exitAfterBindFailure({
      error: bindError('EADDRINUSE'),
      host: '127.0.0.1',
      port: 3000,
      cleanupUpstreamServers: jest.fn(),
      drainUpstreamTerminations: async () => true,
      budgetMs: 3000,
      exit: jest.fn(),
    });

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[FATAL] Cannot listen on 127.0.0.1:3000 (EADDRINUSE); exiting'),
    );
  });

  it('says "all interfaces" when no host was configured', async () => {
    await exitAfterBindFailure({
      error: Object.assign(new Error('boom'), {}) as NodeJS.ErrnoException,
      host: undefined,
      port: '3000',
      cleanupUpstreamServers: jest.fn(),
      drainUpstreamTerminations: async () => true,
      budgetMs: 3000,
      exit: jest.fn(),
    });

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[FATAL] Cannot listen on all interfaces:3000 (boom); exiting'),
    );
  });
});
