import { RequestContextService } from '../../src/services/requestContextService.js';
import { Request } from 'express';

describe('RequestContextService', () => {
  let service: RequestContextService;

  beforeEach(() => {
    service = RequestContextService.getInstance();
    service.clearRequestContext();
  });

  afterEach(() => {
    service.clearRequestContext();
  });

  it('should be a singleton', () => {
    const service1 = RequestContextService.getInstance();
    const service2 = RequestContextService.getInstance();
    expect(service1).toBe(service2);
  });

  it('should set and get request context from Express request', () => {
    const mockRequest = {
      headers: {
        authorization: 'Bearer test-token',
        'x-api-key': 'test-api-key',
        'user-agent': 'test-agent',
      },
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;

    service.setRequestContext(mockRequest);
    const context = service.getRequestContext();

    expect(context).toBeTruthy();
    expect(context?.headers).toEqual(mockRequest.headers);
    expect(context?.userAgent).toBe('test-agent');
    expect(context?.remoteAddress).toBe('127.0.0.1');
  });

  it('should get specific headers case-insensitively', () => {
    const mockRequest = {
      headers: {
        authorization: 'Bearer test-token',
        'X-API-Key': 'test-api-key',
        'content-type': 'application/json',
      },
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;

    service.setRequestContext(mockRequest);

    // Test exact match
    expect(service.getHeader('authorization')).toBe('Bearer test-token');
    expect(service.getHeader('X-API-Key')).toBe('test-api-key');

    // Test case-insensitive match
    expect(service.getHeader('Authorization')).toBe('Bearer test-token');
    expect(service.getHeader('x-api-key')).toBe('test-api-key');
    expect(service.getHeader('CONTENT-TYPE')).toBe('application/json');

    // Test non-existent header
    expect(service.getHeader('non-existent')).toBeUndefined();
  });

  it('should handle array header values', () => {
    const mockRequest = {
      headers: {
        accept: ['application/json', 'text/html'],
        authorization: 'Bearer test-token',
      },
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;

    service.setRequestContext(mockRequest);

    const acceptHeader = service.getHeader('accept');
    expect(acceptHeader).toEqual(['application/json', 'text/html']);

    const authHeader = service.getHeader('authorization');
    expect(authHeader).toBe('Bearer test-token');
  });

  it('should extract session ID from mcp-session-id header', () => {
    const mockRequest = {
      headers: {
        'mcp-session-id': 'test-session-123',
        authorization: 'Bearer test-token',
      },
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;

    service.setRequestContext(mockRequest);

    expect(service.getSessionId()).toBe('test-session-123');
  });

  it('should handle custom request context', () => {
    const customContext = {
      headers: {
        'custom-header': 'custom-value',
        authorization: 'Bearer custom-token',
      },
      sessionId: 'custom-session',
      userAgent: 'custom-agent',
      remoteAddress: '192.168.1.1',
    };

    service.setCustomRequestContext(customContext);
    const context = service.getRequestContext();

    expect(context).toEqual(customContext);
    expect(service.getHeader('custom-header')).toBe('custom-value');
    expect(service.getSessionId()).toBe('custom-session');
  });

  it('should return null when no context is set', () => {
    expect(service.getRequestContext()).toBeNull();
    expect(service.getHeaders()).toBeNull();
    expect(service.getHeader('any-header')).toBeUndefined();
    expect(service.getSessionId()).toBeUndefined();
  });

  it('should clear request context', () => {
    const mockRequest = {
      headers: { authorization: 'Bearer test-token' },
      ip: '127.0.0.1',
      connection: { remoteAddress: '127.0.0.1' },
    } as unknown as Request;

    service.setRequestContext(mockRequest);
    expect(service.getRequestContext()).toBeTruthy();

    service.clearRequestContext();
    expect(service.getRequestContext()).toBeNull();
  });
});
