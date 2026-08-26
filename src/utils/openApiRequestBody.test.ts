import {
  buildMultipartParts,
  encodeFormUrlEncoded,
  makeMultipartBodySchemaModelFriendly,
  selectRequestBodyContent,
  serializeMultipartBody,
  type MultipartPart,
} from './openApiRequestBody.js';
import { OpenAPIV3 } from 'openapi-types';

describe('openApiRequestBody utils (#1078)', () => {
  describe('selectRequestBodyContent', () => {
    test('prefers JSON over urlencoded over multipart', () => {
      const requestBody = {
        content: {
          'multipart/form-data': { schema: { type: 'object' } },
          'application/json': { schema: { type: 'object' } },
          'application/x-www-form-urlencoded': { schema: { type: 'object' } },
        },
      } as OpenAPIV3.RequestBodyObject;

      expect(selectRequestBodyContent(requestBody)?.contentType).toBe('application/json');

      delete requestBody.content['application/json'];
      expect(selectRequestBodyContent(requestBody)?.contentType).toBe(
        'application/x-www-form-urlencoded',
      );

      delete requestBody.content['application/x-www-form-urlencoded'];
      expect(selectRequestBodyContent(requestBody)?.contentType).toBe('multipart/form-data');
    });

    test('matches media types declared with parameters or unusual case', () => {
      const selection = selectRequestBodyContent({
        content: {
          'Application/JSON; charset=utf-8': { schema: { type: 'object' } },
        },
      } as OpenAPIV3.RequestBodyObject);

      expect(selection?.contentType).toBe('application/json');
    });

    test('returns null when nothing is supported', () => {
      expect(selectRequestBodyContent(undefined)).toBeNull();
      expect(selectRequestBodyContent({} as OpenAPIV3.RequestBodyObject)).toBeNull();
      expect(
        selectRequestBodyContent({
          content: { 'text/xml': { schema: { type: 'string' } } },
        } as OpenAPIV3.RequestBodyObject),
      ).toBeNull();
    });
  });

  describe('makeMultipartBodySchemaModelFriendly', () => {
    test('rewrites binary leaves and recurses into nested keywords', () => {
      const schema = {
        type: 'object',
        properties: {
          file: { type: 'string', format: 'binary', description: 'The file' },
          meta: {
            type: 'array',
            items: { type: 'string', format: 'binary' },
          },
          union: { anyOf: [{ type: 'string', format: 'binary' }] },
        },
      };

      const result = makeMultipartBodySchemaModelFriendly(schema) as Record<string, any>;
      expect(result.properties.file.format).toBeUndefined();
      expect(result.properties.file.description).toContain('The file');
      expect(result.properties.file.description).toContain('base64');
      expect(result.properties.meta.items.format).toBeUndefined();
      expect(result.properties.meta.items.description).toContain('base64');
      expect(result.properties.union.anyOf[0].format).toBeUndefined();
    });

    test('terminates on circular schemas left behind by dereference (#959)', () => {
      const node: Record<string, unknown> = {
        type: 'object',
        properties: {
          file: { type: 'string', format: 'binary' },
        },
      };
      node.allOf = [node];

      const result = makeMultipartBodySchemaModelFriendly(node) as Record<string, any>;
      // The walk terminates on cyclic input and a revisited node resolves to
      // the same memoized clone. Cycle-cutting for serialization is NOT done
      // here — extractTools wraps the final inputSchema in createSafeJSON.
      expect(result.properties.file.description).toContain('base64');
      expect(result.allOf[0]).toBe(result);
    });
  });

  describe('buildMultipartParts', () => {
    const schema = {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
        comment: { type: 'string' },
      },
    } as OpenAPIV3.SchemaObject;

    test('decodes binary fields from base64 with default filename and content type', () => {
      const parts = buildMultipartParts(
        { file: Buffer.from('hi').toString('base64'), comment: 'ok' },
        schema,
      );

      expect(parts).toEqual([
        { name: 'file', value: Buffer.from('hi'), filename: 'upload', contentType: 'application/octet-stream' },
        { name: 'comment', value: 'ok' },
      ]);
    });

    test('expands array values into repeated parts and rejects invalid base64', () => {
      const parts = buildMultipartParts({ comment: ['a', 'b'], skip: null }, schema);
      expect(parts.map((p) => p.value)).toEqual(['a', 'b']);

      expect(() => buildMultipartParts({ file: '!!' }, schema)).toThrow(/'file'.*base64/i);
    });

    test('requires an object body', () => {
      expect(() => buildMultipartParts('nope')).toThrow(/object of form fields/i);
    });
  });

  describe('serializeMultipartBody', () => {
    test('frames parts between the boundaries and sanitizes header tokens', () => {
      const parts: MultipartPart[] = [
        { name: 'file', value: Buffer.from('x'), filename: 'a"b\nc.png', contentType: 'image/png' },
        { name: 'comment', value: 'hello' },
      ];

      const body = serializeMultipartBody(parts, 'BOUNDARY').toString('utf8');
      expect(body.startsWith('--BOUNDARY\r\n')).toBe(true);
      expect(body).toContain('name="file"; filename="a_b_c.png"');
      expect(body).toContain('Content-Type: image/png');
      expect(body).toContain('\r\n\r\nhello\r\n');
      expect(body.trimEnd().endsWith('--BOUNDARY--')).toBe(true);
    });
  });

  describe('encodeFormUrlEncoded', () => {
    test('repeats array keys, JSON-stringifies objects, skips nullish values', () => {
      const encoded = encodeFormUrlEncoded({ name: 'a b', tags: ['x', 'y'], meta: { k: 1 }, skip: null });
      const expected = new URLSearchParams([
        ['name', 'a b'],
        ['tags', 'x'],
        ['tags', 'y'],
        ['meta', '{"k":1}'],
      ]).toString();
      expect(encoded).toBe(expected);
    });

    test('requires an object body', () => {
      expect(() => encodeFormUrlEncoded([1, 2])).toThrow(/object of form fields/i);
    });
  });
});
