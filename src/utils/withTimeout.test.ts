import { withTimeout } from './withTimeout.js';

describe('withTimeout', () => {
  it('resolves with the underlying promise value when it settles in time', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 1000, 'timed out')).resolves.toBe('ok');
  });

  it('rejects with the underlying error when it rejects in time', async () => {
    const error = new Error('boom');
    await expect(withTimeout(Promise.reject(error), 1000, 'timed out')).rejects.toBe(error);
  });

  it('rejects with the timeout message when the promise does not settle in time', async () => {
    jest.useFakeTimers();
    try {
      const result = withTimeout(new Promise(() => {}), 500, 'timed out');
      // Attach the rejection handler before advancing timers so the
      // timeout rejection is observed rather than treated as unhandled.
      const assertion = expect(result).rejects.toThrow('timed out');
      await jest.runAllTimersAsync();
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('returns the promise unchanged when the timeout is zero or negative', async () => {
    await expect(withTimeout(Promise.resolve('ok'), 0, 'timed out')).resolves.toBe('ok');
  });
});
