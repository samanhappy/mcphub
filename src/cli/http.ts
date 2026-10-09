import { Client, ProtocolError, StreamableHTTPClientTransport } from '../clients/mcpSdkClient.js';
import { CliApiError } from './errors.js';

export type TokenKind = 'jwt' | 'bearer';

export interface ApiClientOptions {
  baseUrl: string;
  token?: string;
  tokenKind?: TokenKind;
  fetchImpl?: typeof fetch;
}

// Thin fetch wrapper. Auth injection is determined by tokenKind so a single
// client can target dashboard API (JWT via x-auth-token) or scoped bearer key
// (Authorization: Bearer ...) routes. Non-2xx → CliApiError with parsed body.

export class ApiClient {
  private readonly baseUrl: string;
  private readonly token?: string;
  private readonly tokenKind: TokenKind;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.token = opts.token;
    this.tokenKind = opts.tokenKind ?? 'jwt';
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  private buildHeaders(extra?: Record<string, string>): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...(extra ?? {}),
    };
    if (this.token) {
      if (this.tokenKind === 'bearer') {
        headers.Authorization = `Bearer ${this.token}`;
      } else {
        headers['x-auth-token'] = this.token;
      }
    }
    return headers;
  }

  async request<T = unknown>(
    method: string,
    path: string,
    body?: unknown,
    init?: RequestInit,
  ): Promise<T> {
    const url = path.startsWith('http')
      ? path
      : `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
    const headers = this.buildHeaders(init?.headers as Record<string, string> | undefined);
    let payload: BodyInit | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await this.fetchImpl(url, {
      ...init,
      method,
      headers,
      body: payload,
    });
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const message = extractMessage(parsed) ?? `${method} ${path} failed with ${res.status}`;
      throw new CliApiError({
        status: res.status,
        message,
        body: parsed,
        requiresLogin: res.status === 401,
      });
    }

    return parsed as T;
  }

  get<T = unknown>(path: string, init?: RequestInit) {
    return this.request<T>('GET', path, undefined, init);
  }
  post<T = unknown>(path: string, body?: unknown, init?: RequestInit) {
    return this.request<T>('POST', path, body, init);
  }
  put<T = unknown>(path: string, body?: unknown, init?: RequestInit) {
    return this.request<T>('PUT', path, body, init);
  }
  delete<T = unknown>(path: string, init?: RequestInit) {
    return this.request<T>('DELETE', path, undefined, init);
  }

  // POST to /mcp/:group? with a JSON-RPC body. `group` may be a literal group
  // name, '$smart' for smart routing, or null for the global endpoint.
  async mcpCall<T = unknown>(group: string | '$smart' | null, payload: unknown): Promise<T> {
    const suffix = group ? `/${encodeURIComponent(group)}` : '';
    const request = payload as {
      id: string | number;
      params: Parameters<Client['callTool']>[0];
    };
    const transport = new StreamableHTTPClientTransport(new URL(`${this.baseUrl}/mcp${suffix}`), {
      requestInit: { headers: this.buildHeaders() },
      fetch: async (url, init) => {
        const response = await this.fetchImpl(url, init);
        // Keep HTTP failures in the CLI's API-error/exit-code contract.
        if (!response.ok && init?.method === 'POST') {
          const text = await response.text();
          let body: unknown = text;
          try {
            body = JSON.parse(text);
          } catch {
            /* Preserve non-JSON errors. */
          }
          throw new CliApiError({
            status: response.status,
            message: extractMessage(body) ?? `POST /mcp${suffix} failed with ${response.status}`,
            body,
            requiresLogin: response.status === 401,
          });
        }
        return response;
      },
    });
    const client = new Client({ name: 'mcphub-cli', version: '1.0.0' });
    try {
      // Use the sessionful protocol supported by both older and current hubs.
      await client.connect(transport, { prior: { kind: 'legacy' } });
      const result = await client.callTool(request.params);
      return { jsonrpc: '2.0', id: request.id, result } as T;
    } catch (error) {
      if (error instanceof ProtocolError) {
        return {
          jsonrpc: '2.0',
          id: request.id,
          error: { code: error.code, message: error.message, data: error.data },
        } as T;
      }
      throw error;
    } finally {
      try {
        await transport.terminateSession();
      } catch {
        // Session cleanup must not replace a tool result or the original error.
      } finally {
        await client.close();
      }
    }
  }
}

function extractMessage(body: unknown): string | undefined {
  if (body && typeof body === 'object') {
    const obj = body as { message?: unknown; error?: unknown };
    if (typeof obj.message === 'string') return obj.message;
    if (typeof obj.error === 'string') return obj.error;
  }
  if (typeof body === 'string' && body.trim()) return body;
  return undefined;
}
