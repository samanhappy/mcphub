import type { Client } from '../clients/mcpSdkClient.js';
import type {
  ClientCapabilities,
  RequestOptions,
  Server,
  ServerContext,
} from '@modelcontextprotocol/server';

type ElicitationCapabilities = NonNullable<ClientCapabilities['elicitation']>;
type CallContext = Pick<ServerContext['mcpReq'], 'send' | 'signal'>;

const relays = new WeakMap<Client, ElicitationRelay>();

export const getElicitationCapabilities = (
  server?: Server,
): ElicitationCapabilities | undefined => {
  const capability = server?.getClientCapabilities()?.elicitation;
  if (!capability) return undefined;
  // An empty legacy capability means form support, not both modes.
  const modes = {
    ...(capability.form || Object.keys(capability).length === 0 ? { form: {} } : {}),
    ...(capability.url ? { url: {} } : {}),
  };
  return Object.keys(modes).length ? modes : undefined;
};

// Legacy upstream requests carry no portable parent request ID. Serialize each
// session's isolated connection instead of guessing which concurrent call owns it.
class ElicitationRelay {
  private tail: Promise<unknown> = Promise.resolve();
  private active?: { context: CallContext; options: RequestOptions };
  private readonly lifetime = new AbortController();

  constructor(client: Client, downstream: Server) {
    const capabilities = getElicitationCapabilities(downstream);
    const onclose = client.onclose;
    client.onclose = () => {
      this.lifetime.abort();
      onclose?.();
    };
    client.setRequestHandler('elicitation/create', async (request, extra) => {
      const active = this.active;
      if (!active) throw new Error('Elicitation requires an active tool call');
      if (!capabilities?.[request.params.mode ?? 'form']) {
        throw new Error('Client does not support this elicitation mode');
      }
      try {
        return await active.context.send(
          { method: 'elicitation/create', params: request.params },
          {
            ...active.options,
            signal: AbortSignal.any([
              active.context.signal,
              extra.mcpReq.signal,
              this.lifetime.signal,
            ]),
          },
        );
      } catch (error) {
        this.lifetime.abort();
        throw error;
      }
    });
    client.setNotificationHandler('notifications/elicitation/complete', (notification) =>
      downstream.notification(notification),
    );
  }

  get closed(): boolean {
    return this.lifetime.signal.aborted;
  }

  async run<T>(
    context: CallContext | undefined,
    options: RequestOptions,
    call: (options: RequestOptions) => Promise<T>,
  ): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    let callStarted = false;
    try {
      await previous;
      if (!context) throw new Error('Elicitation requires a downstream request');
      const signal = AbortSignal.any([context.signal, this.lifetime.signal]);
      signal.throwIfAborted();
      this.active = { context, options };
      callStarted = true;
      return await call({ ...options, signal });
    } catch (error) {
      // A timed-out call can still elicit later; never hand its connection to
      // the next caller. Session lookup replaces this closed client on demand.
      // Cancelling a queued call has not affected the upstream connection.
      if (callStarted || !context) this.lifetime.abort();
      throw error;
    } finally {
      this.active = undefined;
      release();
    }
  }
}

export const installElicitationRelay = (client: Client, downstream: Server): void => {
  relays.set(client, new ElicitationRelay(client, downstream));
};

export const isElicitationClientClosed = (client: Client): boolean =>
  relays.get(client)?.closed ?? false;

export const withElicitation = <T>(
  client: Client,
  context: CallContext | undefined,
  options: RequestOptions,
  call: (options: RequestOptions) => Promise<T>,
): Promise<T> => {
  const relay = relays.get(client);
  if (!relay) return call(options);
  return relay.run(context, options, call);
};
