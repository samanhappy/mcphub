import http from 'http';
import type { AddressInfo } from 'net';
import type { Socket } from 'net';
import { closeHttpServer } from './serverShutdown.js';

const listen = (server: http.Server): Promise<number> => {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve((server.address() as AddressInfo).port);
    });
  });
};

describe('closeHttpServer', () => {
  it('closes normally without waiting for the grace period', async () => {
    const connections = new Set<Socket>();
    const server = http.createServer((_request, response) => response.end('ok'));
    server.on('connection', (socket) => {
      connections.add(socket);
      socket.once('close', () => connections.delete(socket));
    });

    await listen(server);

    await expect(closeHttpServer(server, connections, 50)).resolves.toBeUndefined();
    expect(console.warn).not.toHaveBeenCalled();
  });

  it('destroys a long-lived connection when the grace period expires', async () => {
    const connections = new Set<Socket>();
    let destroySpy: jest.SpyInstance | undefined;
    const server = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: connected\n\n');
    });
    server.on('connection', (socket) => {
      connections.add(socket);
      destroySpy = jest.spyOn(socket, 'destroy');
      socket.once('close', () => connections.delete(socket));
    });

    const port = await listen(server);
    await new Promise<http.IncomingMessage>((resolve) => {
      http.get(`http://127.0.0.1:${port}`, resolve);
    });

    await expect(closeHttpServer(server, connections, 20)).resolves.toBeUndefined();

    expect(destroySpy).toHaveBeenCalledTimes(1);
    expect(console.warn).toHaveBeenCalledWith(
      '[SHUTDOWN] Grace period expired; force closing HTTP connections',
      expect.objectContaining({ connections: 1, gracePeriodMs: 20 }),
    );
  });
});
