import { Request } from 'express';

/**
 * Request context interface for MCP request handling
 */
export interface RequestContext {
  headers: Record<string, string | string[] | undefined>;
  sessionId?: string;
  userAgent?: string;
  remoteAddress?: string;
}

/**
 * Service for managing request context during MCP request processing
 * This allows MCP request handlers to access HTTP headers and other request metadata
 */
export class RequestContextService {
  private static instance: RequestContextService;
  private requestContext: RequestContext | null = null;

  private constructor() {}

  public static getInstance(): RequestContextService {
    if (!RequestContextService.instance) {
      RequestContextService.instance = new RequestContextService();
    }
    return RequestContextService.instance;
  }

  /**
   * Set the current request context from Express request
   */
  public setRequestContext(req: Request): void {
    this.requestContext = {
      headers: req.headers,
      sessionId: (req.headers['mcp-session-id'] as string) || undefined,
      userAgent: req.headers['user-agent'] as string,
      remoteAddress: req.ip || req.socket?.remoteAddress,
    };
  }

  /**
   * Set request context from custom data
   */
  public setCustomRequestContext(context: RequestContext): void {
    this.requestContext = context;
  }

  /**
   * Get the current request context
   */
  public getRequestContext(): RequestContext | null {
    return this.requestContext;
  }

  /**
   * Get headers from the current request context
   */
  public getHeaders(): Record<string, string | string[] | undefined> | null {
    return this.requestContext?.headers || null;
  }

  /**
   * Get a specific header value (case-insensitive)
   */
  public getHeader(name: string): string | string[] | undefined {
    if (!this.requestContext?.headers) {
      return undefined;
    }

    // Try exact match first
    if (this.requestContext.headers[name]) {
      return this.requestContext.headers[name];
    }

    // Try lowercase match (Express normalizes headers to lowercase)
    const lowerName = name.toLowerCase();
    if (this.requestContext.headers[lowerName]) {
      return this.requestContext.headers[lowerName];
    }

    // Try case-insensitive search
    for (const [key, value] of Object.entries(this.requestContext.headers)) {
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
    this.requestContext = null;
  }

  /**
   * Get session ID from current request context
   */
  public getSessionId(): string | undefined {
    return this.requestContext?.sessionId;
  }
}
