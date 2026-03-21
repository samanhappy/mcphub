import { createSafeJSON, safeStringify } from '../../src/utils/serialization.js';

describe('serialization utilities', () => {
  it('safeStringify preserves nested Error details instead of serializing them as empty objects', () => {
    const error = new Error('boom');
    (error as Error & { code?: string }).code = 'E_BANG';

    const result = safeStringify({
      scope: 'test',
      error,
    });

    expect(result).toContain('"scope":"test"');
    expect(result).toContain('"message":"boom"');
    expect(result).toContain('"name":"Error"');
    expect(result).toContain('"code":"E_BANG"');
    expect(result).toContain('"stack":');
    expect(result).not.toContain('"error":{}');
  });

  it('createSafeJSON preserves nested Error details while still handling circular references', () => {
    const error = new Error('circular boom');
    const payload: Record<string, unknown> = { error };
    payload.self = payload;

    const safePayload = createSafeJSON(payload) as {
      error: { name: string; message: string; stack: string };
      self: string;
    };

    expect(safePayload.error).toEqual(
      expect.objectContaining({
        name: 'Error',
        message: 'circular boom',
      }),
    );
    expect(typeof safePayload.error.stack).toBe('string');
    expect(safePayload.self).toBe('[Circular Reference]');
  });
});
