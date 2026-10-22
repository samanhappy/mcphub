import type { Client } from '../../src/clients/mcpSdkClient.js';
import type { Server } from '@modelcontextprotocol/server';
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
