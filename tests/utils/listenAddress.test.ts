import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import {
  formatBoundAddress,
  getBoundAddress,
  isWildcardHost,
  listenOnAddress,
  resetBoundAddress,
  resolveDisplayHost,
  resolveListenHost,
} from '../../src/utils/listenAddress.js';

const listen = (host: string | undefined, port: number = 0): Promise<Server> =>
  new Promise((resolve, reject) => {
    const server = listenOnAddress(express(), port, host, () => resolve(server), reject);
  });

const close = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

describe('listenAddress utilities', () => {
  describe('getBoundAddress', () => {
    afterEach(() => resetBoundAddress());

    it('is unset before any listener is up', () => {
      expect(getBoundAddress()).toBeUndefined();
    });

    it('records the address and the real port once listening', async () => {
      const server = await listen('127.0.0.1', 0);
      try {
        const actual = server.address() as AddressInfo;
        expect(actual.port).toBeGreaterThan(0);
        expect(getBoundAddress()).toEqual(actual);
        expect(getBoundAddress()?.address).toBe('127.0.0.1');
      } finally {
        await close(server);
      }
    });

    it('is cleared when the listener closes', async () => {
      const server = await listen('127.0.0.1', 0);
      expect(getBoundAddress()).toBeDefined();
      await close(server);
      expect(getBoundAddress()).toBeUndefined();
    });

    it('keeps a newer listener when an older one closes', async () => {
      const older = await listen('127.0.0.1', 0);
      const newer = await listen('127.0.0.1', 0);
      try {
        const newerAddress = newer.address() as AddressInfo;
        await close(older);
        expect(getBoundAddress()).toEqual(newerAddress);
      } finally {
        await close(newer);
      }
    });

    it('stays unset when the bind fails', async () => {
      await expect(listen('192.0.2.1', 0)).rejects.toMatchObject({ code: 'EADDRNOTAVAIL' });
      expect(getBoundAddress()).toBeUndefined();
    });
  });

  describe('isWildcardHost', () => {
    it.each(['0.0.0.0', '::', '[::]'])('recognises %p', (host) => {
      expect(isWildcardHost(host)).toBe(true);
    });

    it.each([undefined, '', '127.0.0.1', '::1', 'localhost'])('rejects %p', (host) => {
      expect(isWildcardHost(host)).toBe(false);
    });
  });

  describe('resolveListenHost', () => {
    it.each([[undefined], [''], ['   ']])('treats %p as unset', (value) => {
      expect(resolveListenHost(value)).toBeUndefined();
    });

    it('trims the configured host', () => {
      expect(resolveListenHost(' 127.0.0.1 ')).toBe('127.0.0.1');
    });

    it.each([
      ['[::]', '::'],
      ['[::1]', '::1'],
      [' [::1] ', '::1'],
    ])('unwraps the bracketed IPv6 literal %p', (value, expected) => {
      expect(resolveListenHost(value)).toBe(expected);
    });

    it('does not turn empty brackets into an unset host', () => {
      expect(resolveListenHost('[]')).toBe('[]');
    });
  });

  describe('listenOnAddress', () => {
    it('binds only the configured address', async () => {
      const server = await listen('127.0.0.1');
      try {
        expect((server.address() as AddressInfo).address).toBe('127.0.0.1');
      } finally {
        await close(server);
      }
    });

    it('binds all interfaces when no host is configured', async () => {
      const server = await listen(undefined);
      try {
        expect(['::', '0.0.0.0']).toContain((server.address() as AddressInfo).address);
      } finally {
        await close(server);
      }
    });

    it('binds the IPv6 wildcard when configured as a bracketed literal', async () => {
      const server = await listen(resolveListenHost('[::]'));
      try {
        expect((server.address() as AddressInfo).address).toBe('::');
      } finally {
        await close(server);
      }
    });

    it('reports an unbindable host through onError instead of falling back to all interfaces', async () => {
      // 192.0.2.0/24 is reserved for documentation (RFC 5737), so no local interface owns it.
      await expect(listen('192.0.2.1')).rejects.toMatchObject({ code: 'EADDRNOTAVAIL' });
    });

    it('detaches onError once the server is listening', async () => {
      const onError = jest.fn();
      const server = await new Promise<Server>((resolve, reject) => {
        const created = listenOnAddress(
          express(),
          0,
          '127.0.0.1',
          () => resolve(created),
          (error) => {
            onError(error);
            reject(error);
          },
        );
      });
      try {
        expect(server.listeners('error')).toHaveLength(0);
        expect(onError).not.toHaveBeenCalled();
      } finally {
        await close(server);
      }
    });

    it('reports a port that is already in use through onError', async () => {
      const first = await listen('127.0.0.1');
      try {
        const { port } = first.address() as AddressInfo;
        await expect(listen('127.0.0.1', port)).rejects.toMatchObject({ code: 'EADDRINUSE' });
      } finally {
        await close(first);
      }
    });
  });

  describe('formatBoundAddress', () => {
    it('formats IPv4 and IPv6 socket addresses', () => {
      expect(formatBoundAddress({ address: '127.0.0.1', family: 'IPv4', port: 3000 })).toBe(
        '127.0.0.1:3000',
      );
      expect(formatBoundAddress({ address: '::', family: 'IPv6', port: 3000 })).toBe('[::]:3000');
    });

    it('passes through a pipe path and handles a missing address', () => {
      expect(formatBoundAddress('/tmp/mcphub.sock')).toBe('/tmp/mcphub.sock');
      expect(formatBoundAddress(null)).toBe('unknown address');
    });
  });

  describe('resolveDisplayHost', () => {
    it.each([[undefined], ['0.0.0.0'], ['::'], ['[::]']])('shows localhost for %p', (host) => {
      expect(resolveDisplayHost(host)).toBe('localhost');
    });

    it('shows a specific host, bracketing bare IPv6 addresses', () => {
      expect(resolveDisplayHost('127.0.0.1')).toBe('127.0.0.1');
      expect(resolveDisplayHost('::1')).toBe('[::1]');
      expect(resolveDisplayHost('[::1]')).toBe('[::1]');
    });
  });
});
