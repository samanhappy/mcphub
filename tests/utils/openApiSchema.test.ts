import Ajv from 'ajv';
import {
  collectDefinitions,
  fromOpenApiSchema,
  toOpenApiSchema,
} from '../../src/utils/openApiSchema.js';

// Ajv implements the OpenAPI 3.0 `nullable` keyword, so it shows what a converted schema accepts
const accepts = (schema: unknown, value: unknown): boolean =>
  new Ajv({ strict: false }).compile(schema as object)(value) as boolean;

describe('OpenAPI input schema conversion', () => {
  it.each([
    { type: 'string', nullable: true },
    { type: 'integer', nullable: false },
    { type: 'string', nullable: true, enum: ['a'] },
    { type: 'string', nullable: true, enum: ['a', null] },
    { allOf: [{ type: 'string', nullable: true }, { enum: ['a'] }] },
    { anyOf: [{ type: 'string', nullable: true }, { type: 'integer' }] },
    { oneOf: [{ type: 'string', nullable: true }, { type: 'integer' }] },
    { not: { type: 'string', nullable: true } },
    { type: 'array', nullable: true, items: { type: 'string', nullable: true } },
    {
      type: 'object',
      properties: { value: { type: 'integer', nullable: true } },
      required: ['value'],
      additionalProperties: false,
    },
    { type: 'object', additionalProperties: { type: 'string', nullable: true } },
  ])('preserves allowed values for %j', (schema) => {
    const converted = fromOpenApiSchema(schema);
    expect(JSON.stringify(converted)).not.toContain('"nullable"');
    for (const value of [
      'a',
      'b',
      1,
      1.5,
      null,
      true,
      [],
      [null],
      ['a'],
      [1],
      {},
      { value: null },
      { value: 'a' },
    ]) {
      expect(accepts(converted, value)).toBe(accepts(schema, value));
    }
  });

  it('does not infer a type or rewrite schema-shaped data and property names', () => {
    const data = { type: 'string', nullable: true };
    expect(fromOpenApiSchema({ nullable: true, enum: ['a'] })).toEqual({ enum: ['a'] });
    expect(
      fromOpenApiSchema({
        type: 'object',
        properties: { nullable: data },
        example: data,
        default: data,
        enum: [data],
      }),
    ).toEqual({
      type: 'object',
      properties: { nullable: { type: ['string', 'null'] } },
      example: data,
      default: data,
      enum: [data],
    });
    expect(fromOpenApiSchema({ type: ['string', 'null'] })).toEqual({ type: ['string', 'null'] });
  });
});

describe('OpenAPI schema conversion', () => {
  describe('accepts the same values as the JSON Schema it replaces', () => {
    it.each([
      ['a single type', { type: ['string', 'null'] }, ['a', null, 1, true]],
      ['several types', { type: ['string', 'integer', 'null'] }, ['a', 1, null, true, 1.5, {}]],
      ['several types without null', { type: ['string', 'integer'] }, ['a', 1, null, true]],
      [
        'an anyOf member with an enum',
        { anyOf: [{ type: 'string', enum: ['a'] }, { type: 'null' }] },
        ['a', null, 'b', 1],
      ],
      [
        'an anyOf member with a const',
        { anyOf: [{ const: 'a' }, { type: 'null' }] },
        ['a', null, 'b', 1],
      ],
      [
        'an anyOf with several members',
        { anyOf: [{ type: 'string' }, { type: 'integer' }, { type: 'null' }] },
        ['a', 1, null, true],
      ],
      [
        'a oneOf with several members',
        { oneOf: [{ type: 'string' }, { type: 'integer' }, { type: 'null' }] },
        ['a', 1, null, true],
      ],
      [
        'a type list with an enum that excludes null',
        { type: ['string', 'null'], enum: ['a', 'b'] },
        ['a', 'b', null, 'c'],
      ],
      [
        'a type list with an enum that includes null',
        { type: ['string', 'null'], enum: ['a', null] },
        ['a', null, 'b'],
      ],
      ['a const', { const: 'a' }, ['a', null, 'b']],
      [
        'nullable properties',
        {
          type: 'object',
          properties: {
            x: { type: ['string', 'integer', 'null'] },
            y: { anyOf: [{ type: 'boolean' }, { type: 'null' }] },
          },
        },
        [{ x: null, y: null }, { x: 'a', y: true }, { x: true }, { y: 'no' }, {}],
      ],
      [
        'nullable array items',
        { type: 'array', items: { type: ['integer', 'null'] } },
        [[1, null, 2], ['a'], []],
      ],
    ])('%s', (_name, original, probes) => {
      const converted = toOpenApiSchema(original);

      for (const value of probes) {
        expect({ value, accepted: accepts(converted, value) }).toEqual({
          value,
          accepted: accepts(original, value),
        });
      }
    });

    it('still accepts null where the original did', () => {
      for (const original of [
        { type: ['string', 'integer', 'null'] },
        { anyOf: [{ type: 'string', enum: ['a'] }, { type: 'null' }] },
        { anyOf: [{ const: 'a' }, { type: 'null' }] },
      ]) {
        expect(accepts(toOpenApiSchema(original), null)).toBe(true);
      }
    });

    it('does not make a non-nullable enum accept null', () => {
      const converted = toOpenApiSchema({ type: 'string', enum: ['a'] });

      expect(accepts(converted, 'a')).toBe(true);
      expect(accepts(converted, null)).toBe(false);
    });
  });

  describe('local definitions', () => {
    it('collects definitions from $defs and definitions', () => {
      expect(
        collectDefinitions({
          $defs: { A: { type: 'string' } },
          definitions: { B: { type: 'number' } },
        }),
      ).toEqual({ A: { type: 'string' }, B: { type: 'number' } });
    });

    it('keeps a reference it cannot resolve', () => {
      expect(toOpenApiSchema({ $ref: '#/$defs/Missing' })).toEqual({ $ref: '#/$defs/Missing' });
    });

    it('keeps a reference outside the tool schema', () => {
      expect(toOpenApiSchema({ $ref: 'https://example.com/schema.json' })).toEqual({
        $ref: 'https://example.com/schema.json',
      });
    });

    it('accepts the same values after inlining a nullable definition', () => {
      const definitions = { Limit: { type: ['integer', 'null'], minimum: 1 } };
      const converted = toOpenApiSchema({ $ref: '#/$defs/Limit' }, definitions);

      expect(accepts(converted, 5)).toBe(true);
      expect(accepts(converted, null)).toBe(true);
      expect(accepts(converted, 0)).toBe(false);
      expect(accepts(converted, 'x')).toBe(false);
    });
  });
});
