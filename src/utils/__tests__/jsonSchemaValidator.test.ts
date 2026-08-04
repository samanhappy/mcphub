import { describe, expect, it } from '@jest/globals';

import { ResilientJsonSchemaValidator } from '../jsonSchemaValidator.js';

describe('ResilientJsonSchemaValidator', () => {
  const validator = new ResilientJsonSchemaValidator();

  it('validates well-formed output schemas strictly', () => {
    const validate = validator.getValidator<{ count: number }>({
      type: 'object',
      properties: { count: { type: 'number' } },
      required: ['count'],
    });

    expect(validate({ count: 42 })).toEqual({
      valid: true,
      data: { count: 42 },
      errorMessage: undefined,
    });
    expect(validate({ count: 'not-a-number' }).valid).toBe(false);
    expect(validate({}).valid).toBe(false);
  });

  it('validates recursive $ref schemas when the $defs are in scope', () => {
    const validate = validator.getValidator<Record<string, unknown>>({
      type: 'object',
      properties: { screenInstance: { $ref: '#/$defs/ScreenInstance' } },
      $defs: {
        ScreenInstance: {
          type: 'object',
          properties: {
            variantScreenInstance: { $ref: '#/$defs/ScreenInstance' },
          },
        },
      },
    });

    expect(
      validate({ screenInstance: { variantScreenInstance: { variantScreenInstance: {} } } }).valid,
    ).toBe(true);
  });

  it('does not throw on an unresolvable $ref and falls back to passthrough', () => {
    // Mirrors the Stitch server schema that failed tool discovery (issue #1024).
    const validate = validator.getValidator<Record<string, unknown>>({
      type: 'object',
      properties: { screenInstance: { $ref: '#/$defs/ScreenInstance' } },
    });

    expect(validate({ anything: 'goes' })).toEqual({
      valid: true,
      data: { anything: 'goes' },
      errorMessage: undefined,
    });
    expect(validate(null)).toEqual({
      valid: true,
      data: null,
      errorMessage: undefined,
    });
  });

  it('keeps validating after a schema failed to compile', () => {
    const broken = validator.getValidator({
      type: 'object',
      properties: { screenInstance: { $ref: '#/$defs/Missing' } },
    });
    const healthy = validator.getValidator<{ ok: boolean }>({
      type: 'object',
      properties: { ok: { type: 'boolean' } },
      required: ['ok'],
    });

    expect(broken({ x: 1 }).valid).toBe(true);
    expect(healthy({ ok: true }).valid).toBe(true);
    expect(healthy({ ok: 'nope' }).valid).toBe(false);
  });
});
