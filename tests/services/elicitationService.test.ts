import type { Client } from '../../src/clients/mcpSdkClient.js';
import type { Server, ServerContext } from '@modelcontextprotocol/server';
import {
  installElicitationRelay,
  isElicitationClientClosed,
  withElicitation,
} from '../../src/services/elicitationService.js';

const setup = () => {
  const setRequestHandler = jest.fn();
  const client = {
    setRequestHandler,
    setNotificationHandler: jest.fn(),
  } as unknown as Client;
  const downstream = {
    getClientCapabilities: () => ({ elicitation: { form: {} } }),
    notification: jest.fn(),
  } as unknown as Server;
  installElicitationRelay(client, downstream);
  return { client, handler: setRequestHandler.mock.calls[0][1] };
};

test('refuses unsolicited elicitation without an active originating operation', async () => {
  const { handler } = setup();
  await expect(handler({ params: { mode: 'form' } }, {})).rejects.toThrow('active tool call');
});

test('invalidates the relay when a caller lacks a downstream request context', async () => {
  const { client } = setup();
  const call = jest.fn();
  await expect(withElicitation(client, undefined, {}, call)).rejects.toThrow('downstream request');
  expect(call).not.toHaveBeenCalled();
  expect(isElicitationClientClosed(client)).toBe(true);
});

test('cancelling an unsent queued call preserves the connection for later calls', async () => {
  const { client } = setup();
  const context = (signal: AbortSignal): Pick<ServerContext['mcpReq'], 'send' | 'signal'> => ({
    signal,
    send: jest.fn(),
  });
  let release!: () => void;
  const first = withElicitation(client, context(new AbortController().signal), {}, () =>
    new Promise<void>((resolve) => {
      release = resolve;
    }),
  );
  await Promise.resolve();
  const abort = new AbortController();
  const secondCall = jest.fn();
  const second = withElicitation(client, context(abort.signal), {}, secondCall);
  const rejection = expect(second).rejects.toThrow();
  const thirdCall = jest.fn(async () => 'ok');
  const third = withElicitation(client, context(new AbortController().signal), {}, thirdCall);
  // Attach before releasing the queue so an unexpected rejection is handled.
  const outcome = expect(third).resolves.toBe('ok');
  abort.abort();
  release();
  await first;
  await rejection;
  await outcome;
  expect(secondCall).not.toHaveBeenCalled();
  expect(thirdCall).toHaveBeenCalledTimes(1);
  expect(isElicitationClientClosed(client)).toBe(false);
});
