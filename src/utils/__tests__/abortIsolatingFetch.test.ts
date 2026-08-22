import { describe, expect, it, jest } from '@jest/globals';
import { getEventListeners, getMaxListeners, setMaxListeners } from 'node:events';

import { createAbortIsolatingFetch, type FetchLike } from '../abortIsolatingFetch.js';

const makeResponse = (status = 200, body: BodyInit = ''): Response =>
  new Response(body, { status });

// Mimics undici's behavior that causes the #1022 leak: every fetch call
// registers an abort listener on the passed-in signal and only removes it
// when the signal fires or the request object is garbage collected.
const leakyFetch = (signalRef: { signal?: AbortSignal }): FetchLike => {
  return (url, init) => {
    const signal = init?.signal;
    if (signal) {
      signalRef.signal = signal;
      const listener = () => {};
      signal.addEventListener('abort', listener);
    }
    return Promise.resolve(makeResponse());
  };
};

describe('createAbortIsolatingFetch', () => {
  it('keeps parent-signal listeners bounded under sustained load', async () => {
    const shared = new AbortController();
    const seen: { signal?: AbortSignal } = {};
    // Undici raises the limit to 1500 on the first warning; mirror that so the
    // test reproduces production conditions instead of tripping at default 10.
    setMaxListeners(1500, shared.signal);
    const fetch = createAbortIsolatingFetch(leakyFetch(seen));

    for (let i = 0; i < 2000; i++) {
      await fetch('https://example.com/mcp', { signal: shared.signal });
    }

    // Each request must hand a private signal to the underlying fetch...
    expect(seen.signal).not.toBe(shared.signal);
    // ...and the wrapper's bridge listener is removed after each settle.
    expect(getEventListeners(shared.signal, 'abort')).toHaveLength(0);
  });

  it('propagates parent abort to the in-flight private signal', async () => {
    const shared = new AbortController();
    let privateSignal: AbortSignal | undefined;
    const baseFetch: FetchLike = (url, init) => {
      privateSignal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), {
          once: true,
        });
      });
    };
    const fetch = createAbortIsolatingFetch(baseFetch);

    const pending = fetch('https://example.com/mcp', { signal: shared.signal });
    await Promise.resolve();
    shared.abort(new Error('transport closed'));

    await expect(pending).rejects.toMatchObject({ message: 'transport closed' });
    expect(privateSignal?.aborted).toBe(true);
    expect(privateSignal?.reason).toBe(shared.signal.reason);
  });

  it('passes through calls without a signal untouched', async () => {
    const baseFetch = jest.fn(async (_url: string | URL, init?: RequestInit) => {
      return makeResponse();
    }) as unknown as jest.Mock & FetchLike;

    const fetch = createAbortIsolatingFetch(baseFetch);
    await fetch('https://example.com/mcp', { headers: { 'x-a': '1' } });

    expect(baseFetch).toHaveBeenCalledTimes(1);
    const [url, init] = baseFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://example.com/mcp');
    expect(init.signal).toBeUndefined();
    expect(init.headers).toEqual({ 'x-a': '1' });
  });

  it('does not leave bridge listeners behind when the request rejects', async () => {
    const shared = new AbortController();
    const baseFetch: FetchLike = () => Promise.reject(new Error('boom'));
    const fetch = createAbortIsolatingFetch(baseFetch);

    await expect(fetch('https://example.com/mcp', { signal: shared.signal })).rejects.toThrow(
      'boom',
    );
    expect(getEventListeners(shared.signal, 'abort')).toHaveLength(0);
  });

  it('removes the bridge listener once the response settles normally', async () => {
    const shared = new AbortController();
    const baseFetch: FetchLike = () => Promise.resolve(makeResponse());
    const fetch = createAbortIsolatingFetch(baseFetch);

    await fetch('https://example.com/mcp', { signal: shared.signal });
    expect(getEventListeners(shared.signal, 'abort')).toHaveLength(0);
  });
});
