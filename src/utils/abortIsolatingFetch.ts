import type { FetchLike } from './ssrf.js';

/**
 * Wraps a fetch so each request receives its own AbortSignal instead of the
 * caller's long-lived one.
 *
 * Why: the MCP SDK's StreamableHTTPClientTransport shares a single
 * AbortController across every request on a connection, and undici registers
 * an abort listener on the passed signal per fetch call, removing it only on
 * abort or GC. Under sustained traffic the shared signal accumulates tens of
 * thousands of listeners (MaxListenersExceededWarning, #1022). Bridging
 * through a per-request controller keeps at most one in-flight listener on
 * the parent signal, and it is removed deterministically when the request
 * settles.
 */
export const createAbortIsolatingFetch = (baseFetch: FetchLike): FetchLike => {
  return async (url, init) => {
    const parentSignal = init?.signal;
    if (!parentSignal) {
      return baseFetch(url, init);
    }

    const controller = new AbortController();
    const onAbort = () => controller.abort(parentSignal.reason);
    parentSignal.addEventListener('abort', onAbort, { once: true });
    try {
      return await baseFetch(url, { ...init, signal: controller.signal });
    } finally {
      parentSignal.removeEventListener('abort', onAbort);
    }
  };
};
