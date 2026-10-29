let effect: () => () => void;
const apiGet = jest.fn();
jest.mock('react', () => ({
  useState: () => [[], jest.fn()],
  useRef: () => ({ current: null }),
  useCallback: (callback: unknown) => callback,
  useEffect: (callback: typeof effect) => {
    effect = callback;
  },
}));
jest.mock('../../frontend/src/utils/fetchInterceptor', () => ({
  apiGet: (...args: unknown[]) => apiGet(...args),
}));
import { useCostData } from '../../frontend/src/hooks/useCostData';

const success = { success: true, data: [] };
const flush = async () => {
  await jest.advanceTimersByTimeAsync(0);
};

beforeEach(() => {
  jest.useFakeTimers();
  apiGet.mockReset();
});
afterEach(() => jest.useRealTimers());

it('retries unsuccessful API responses and stops after recovery without a revision change', async () => {
  apiGet
    .mockResolvedValueOnce(success)
    .mockResolvedValueOnce({ success: false })
    .mockResolvedValue(success);
  useCostData('unchanged');
  const cleanup = effect();
  await flush();
  expect(apiGet).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(2000);
  expect(apiGet).toHaveBeenCalledTimes(4);
  await jest.advanceTimersByTimeAsync(60000);
  expect(apiGet).toHaveBeenCalledTimes(4);
  cleanup();
});

it('bounds retries for persistent network failures', async () => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  apiGet.mockRejectedValue(new Error('offline'));
  useCostData('unchanged');
  const cleanup = effect();
  await jest.advanceTimersByTimeAsync(60000);
  expect(apiGet).toHaveBeenCalledTimes(8); // Initial attempt plus three retries, two endpoints each.
  expect(jest.getTimerCount()).toBe(0);
  cleanup();
  log.mockRestore();
});

it('cancels scheduled retries on effect cleanup', async () => {
  apiGet.mockResolvedValue({ success: false });
  useCostData('old');
  const cleanup = effect();
  await flush();
  cleanup();
  await jest.advanceTimersByTimeAsync(60000);
  expect(apiGet).toHaveBeenCalledTimes(2);
});

it('does not schedule a retry if an active request fails after cleanup', async () => {
  let resolve!: (value: unknown) => void;
  apiGet
    .mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValueOnce(success);
  useCostData('old');
  const cleanup = effect();
  cleanup();
  resolve({ success: false });
  await flush();
  expect(jest.getTimerCount()).toBe(0);
});
