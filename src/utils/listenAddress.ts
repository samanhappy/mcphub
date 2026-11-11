import type { Application } from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';

const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]']);

/**
 * Normalizes MCPHUB_HOST. An unset or blank value returns undefined, which keeps
 * Node's default of listening on all interfaces. A bracketed IPv6 literal such as
 * `[::1]` is unwrapped, because `listen()` expects the bare address.
 */
export const resolveListenHost = (value: string | undefined): string | undefined => {
  const host = value?.trim();
  if (!host) {
    return undefined;
  }
  // Only a non-empty bracketed literal is unwrapped: `[]` must not become "unset".
  const bracketed = /^\[(.+)\]$/.exec(host);
  return bracketed ? bracketed[1] : host;
};

/**
 * Starts the HTTP listener. Without a host the call is identical to the historic
 * `app.listen(port, callback)`, so PORT keeps accepting everything it accepted before.
 *
 * A bind failure (address not available, port in use) is reported asynchronously as an
 * `error` event. It is routed to `onError` so the caller can stop the process instead of
 * leaving it without a listener. The handler covers startup only and is removed once the
 * server is listening, so later server errors keep their previous handling.
 */
export const listenOnAddress = (
  app: Application,
  port: number | string,
  host: string | undefined,
  onListening: () => void,
  onError: (error: NodeJS.ErrnoException) => void,
): Server => {
  const server = host ? app.listen(Number(port), host, onListening) : app.listen(port, onListening);
  server.once('error', onError);
  server.once('listening', () => {
    server.off('error', onError);
    const address = server.address();
    if (address && typeof address === 'object') {
      boundAddress = address;
      server.once('close', () => {
        if (boundAddress === address) {
          boundAddress = undefined;
        }
      });
    }
  });
  return server;
};

/** True for an address that listens on every interface, such as `0.0.0.0` or `::`. */
export const isWildcardHost = (host: string | undefined): boolean =>
  !!host && WILDCARD_HOSTS.has(host);

let boundAddress: AddressInfo | undefined;

/** Address and port the HTTP listener actually bound, while it is listening. */
export const getBoundAddress = (): AddressInfo | undefined => boundAddress;

/** Test hook: forget the recorded listener address. */
export const resetBoundAddress = (): void => {
  boundAddress = undefined;
};

/** Renders the address the listener actually bound, for example `127.0.0.1:3000` or `[::]:3000`. */
export const formatBoundAddress = (address: AddressInfo | string | null | undefined): string => {
  if (!address) {
    return 'unknown address';
  }
  if (typeof address === 'string') {
    return address;
  }
  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  return `${host}:${address.port}`;
};

/** Host to show in browser URLs: wildcard binds are reachable through localhost. */
export const resolveDisplayHost = (host: string | undefined): string => {
  if (!host || WILDCARD_HOSTS.has(host)) {
    return 'localhost';
  }
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
};
