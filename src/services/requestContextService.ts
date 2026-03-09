import { AsyncLocalStorage } from 'node:async_hooks';
import { Request } from 'express';

/**
 * Request context interface for MCP request handling
 */
export interface RequestContext {
  headers: Record<string, string | string[] | undefined>;
  sessionId?: string;
  userAgent?: string;
  remoteAddress?: string;
  group?: string;
  keyId?: string;
  keyName?: string;
}

/**
 * Service for managing request context during MCP request processing
 * This allows MCP request handlers to access HTTP headers and other request metadata
 */
export class RequestContextService {
  private static instance: RequestContextService;
  private readonly asyncLocalStorage = new AsyncLocalStorage<RequestContext | null>();

  private constructor() {}

  public static getInstance(): RequestContextService {
    if (!RequestContextService.instance) {
      RequestContextService.instance = new RequestContextService();
    }
    return RequestContextService.instance;
  }

  private createRequestContext(req: Request): RequestContext {
    return {
      headers: req.headers,
      sessionId: (req.headers['mcp-session-id'] as string) || undefined,
      userAgent: req.headers['user-agent'] as string,
      remoteAddress: req.ip || req.socket?.remoteAddress,
    };
  }

  private cloneRequestContext(context: RequestContext): RequestContext {
    return {
      ...context,
      headers: { ...context.headers },
    };
  }

  public runWithRequestContext<T>(req: Request, callback: () => T): T;
  public runWithRequestContext<T>(req: Request, callback: () => Promise<T>): Promise<T>;
  public runWithRequestContext<T>(req: Request, callback: () => T | Promise<T>): T | Promise<T> {
    return this.asyncLocalStorage.run(this.createRequestContext(req), callback);
  }

  public runWithCustomRequestContext<T>(context: RequestContext, callback: () => T): T;
  public runWithCustomRequestContext<T>(context: RequestContext, callback: () => Promise<T>): Promise<T>;
  public runWithCustomRequestContext<T>(
    context: RequestContext,
    callback: () => T | Promise<T>,
  ): T | Promise<T> {
    return this.asyncLocalStorage.run(this.cloneRequestContext(context), callback);
  }

  /**
   * Set the current request context from Express request
   */
  public setRequestContext(req: Request): void {
    this.asyncLocalStorage.enterWith(this.createRequestContext(req));
  }

  /**
   * Set request context from custom data
   */
  public setCustomRequestContext(context: RequestContext): void {
    this.asyncLocalStorage.enterWith(this.cloneRequestContext(context));
  }

  /**
   * Get the current request context
   */
  public getRequestContext(): RequestContext | null {
    return this.asyncLocalStorage.getStore() ?? null;
  }

  /**
   * Get headers from the current request context
   */
  public getHeaders(): Record<string, string | string[] | undefined> | null {
    return this.getRequestContext()?.headers || null;
  }

  /**
   * Get a specific header value (case-insensitive)
   */
  public getHeader(name: string): string | string[] | undefined {
    const requestContext = this.getRequestContext();
    if (!requestContext?.headers) {
      return undefined;
    }

    // Try exact match first
    if (requestContext.headers[name]) {
      return requestContext.headers[name];
    }

    // Try lowercase match (Express normalizes headers to lowercase)
    const lowerName = name.toLowerCase();
    if (requestContext.headers[lowerName]) {
      return requestContext.headers[lowerName];
    }

    // Try case-insensitive search
    for (const [key, value] of Object.entries(requestContext.headers)) {
      if (key.toLowerCase() === lowerName) {
        return value;
      }
    }

    return undefined;
  }

  /**
   * Clear the current request context
   */
  public clearRequestContext(): void {
    this.asyncLocalStorage.enterWith(null);
  }

  /**
   * Get session ID from current request context
   */
  public getSessionId(): string | undefined {
    return this.getRequestContext()?.sessionId;
  }

  /**
   * Set bearer key context for activity logging
   */
  public setBearerKeyContext(keyId?: string, keyName?: string): void {
    const requestContext = this.getRequestContext();
    if (requestContext) {
      requestContext.keyId = keyId;
      requestContext.keyName = keyName;
    }
  }

  /**
   * Set group context for activity logging
   */
  public setGroupContext(group?: string): void {
    const requestContext = this.getRequestContext();
    if (requestContext) {
      requestContext.group = group;
    }
  }

  /**
   * Get bearer key context
   */
  public getBearerKeyContext(): { keyId?: string; keyName?: string } {
    const requestContext = this.getRequestContext();
    return {
      keyId: requestContext?.keyId,
      keyName: requestContext?.keyName,
    };
  }

  /**
   * Get group context
   */
  public getGroupContext(): string | undefined {
    return this.getRequestContext()?.group;
  }
}
