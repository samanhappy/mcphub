jest.mock('../../frontend/src/utils/fetchInterceptor', () => ({
  apiGet: jest.fn(),
  apiDelete: jest.fn(),
}));

jest.mock('../../frontend/src/utils/runtime', () => ({
  getApiUrl: (path: string) => `http://localhost:3000/api${path}`,
}));

jest.mock('../../frontend/src/utils/interceptors', () => ({
  getToken: () => 'test-token',
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];

  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(public url: string) {
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

describe('LogStreamManager reconnect backoff', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    FakeEventSource.instances = [];
    (global as unknown as { EventSource: unknown }).EventSource = FakeEventSource;
  });

  afterEach(() => {
    jest.useRealTimers();
    delete (global as unknown as { EventSource?: unknown }).EventSource;
  });

  it('backs off exponentially when the stream never opens', async () => {
    const { logStreamManager } = await import('../../frontend/src/services/logService');
    const unsubscribe = logStreamManager.subscribe(() => {});

    expect(FakeEventSource.instances).toHaveLength(1);

    // First failure: reconnect after 1s.
    FakeEventSource.instances[0].onerror?.();
    jest.advanceTimersByTime(999);
    expect(FakeEventSource.instances).toHaveLength(1);
    jest.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(2);

    // Second failure: the delay must grow to 2s rather than staying at 1s.
    FakeEventSource.instances[1].onerror?.();
    jest.advanceTimersByTime(1000);
    expect(FakeEventSource.instances).toHaveLength(2);
    jest.advanceTimersByTime(1000);
    expect(FakeEventSource.instances).toHaveLength(3);

    unsubscribe();
  });

  it('resets the backoff only after the connection actually opens', async () => {
    const { logStreamManager } = await import('../../frontend/src/services/logService');
    const unsubscribe = logStreamManager.subscribe(() => {});

    // Burn one step of backoff.
    FakeEventSource.instances[0].onerror?.();
    jest.advanceTimersByTime(1000);
    expect(FakeEventSource.instances).toHaveLength(2);

    // This attempt genuinely opens, so the next failure starts from 1s again.
    FakeEventSource.instances[1].onopen?.();
    FakeEventSource.instances[1].onerror?.();
    jest.advanceTimersByTime(1000);
    expect(FakeEventSource.instances).toHaveLength(3);

    unsubscribe();
  });
});
