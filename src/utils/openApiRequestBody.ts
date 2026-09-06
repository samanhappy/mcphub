import { OpenAPIV3 } from 'openapi-types';

/**
 * Request-body handling for OpenAPI tool operations: resolving an operation's
 * declared body content type, advertising it in a model-friendly tool schema,
 * and serializing outgoing bodies per content type (#1078).
 *
 * Schema advertisement (OpenAPIClient.generateInputSchema) and outgoing
 * serialization (OpenAPIClient.callTool) both resolve the operation's body
 * through selectRequestBodyContent so they can never drift apart.
 */

// Request-body content types the hub can advertise and serialize, in the order
// they are preferred when an operation declares several.
const REQUEST_BODY_CONTENT_TYPE_PRIORITY = [
  'application/json',
  'application/x-www-form-urlencoded',
  'multipart/form-data',
] as const;

export type SupportedRequestBodyContentType = (typeof REQUEST_BODY_CONTENT_TYPE_PRIORITY)[number];

export interface RequestBodyContentSelection {
  contentType: SupportedRequestBodyContentType;
  mediaType: OpenAPIV3.MediaTypeObject;
}

// Media type keys may carry parameters ('application/json; charset=utf-8');
// compare on the bare type so those declarations still match.
function normalizeMediaTypeKey(key: string): string {
  return key.split(';')[0].trim().toLowerCase();
}

export function selectRequestBodyContent(
  requestBody?: OpenAPIV3.RequestBodyObject | null,
): RequestBodyContentSelection | null {
  const content = requestBody?.content;
  if (!content) {
    return null;
  }

  for (const contentType of REQUEST_BODY_CONTENT_TYPE_PRIORITY) {
    const key = Object.keys(content).find((k) => normalizeMediaTypeKey(k) === contentType);
    if (!key) {
      continue;
    }
    const mediaType = content[key];
    if (mediaType) {
      return { contentType, mediaType };
    }
  }
  return null;
}

// Rewrites a multipart/form-data body schema for model consumption. Binary
// fields (`type: string, format: binary`) become plain strings carrying
// base64-encoded contents, because tool arguments arrive as JSON — a model
// cannot produce raw bytes. The rewrite must tolerate the circular references
// SwaggerParser.dereference leaves behind (#959), hence the memoized walk.
const MULTIPART_BINARY_FIELD_HINT =
  'Provide base64-encoded file contents; MCPHub decodes them and uploads the bytes as this file part. An object {content, filename, contentType} may be supplied instead of a bare string to control the uploaded filename and MIME type.';

export function makeMultipartBodySchemaModelFriendly(schema: unknown): unknown {
  const cache = new Map<object, unknown>();

  const transform = (node: unknown): unknown => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      return node;
    }
    const cached = cache.get(node);
    if (cached !== undefined) {
      return cached;
    }

    const source = node as Record<string, unknown>;
    const clone: Record<string, unknown> = { ...source };
    cache.set(node, clone);

    if (source.type === 'string' && source.format === 'binary') {
      delete clone.format;
      const ownDescription =
        typeof source.description === 'string' ? `${source.description.trim()} ` : '';
      clone.description = `${ownDescription}${MULTIPART_BINARY_FIELD_HINT}`;
    }

    if (clone.items) {
      clone.items = transform(clone.items);
    }
    if (clone.additionalProperties && typeof clone.additionalProperties === 'object') {
      clone.additionalProperties = transform(clone.additionalProperties);
    }
    for (const keyword of ['properties', 'patternProperties'] as const) {
      const nested = clone[keyword];
      if (nested && typeof nested === 'object') {
        const transformed: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(nested as Record<string, unknown>)) {
          transformed[key] = transform(value);
        }
        clone[keyword] = transformed;
      }
    }
    for (const keyword of ['anyOf', 'oneOf', 'allOf', 'prefixItems'] as const) {
      if (Array.isArray(clone[keyword])) {
        clone[keyword] = (clone[keyword] as unknown[]).map(transform);
      }
    }

    return clone;
  };

  return transform(schema);
}

export interface MultipartPart {
  name: string;
  value: string | Buffer;
  filename?: string;
  contentType?: string;
}

const DEFAULT_UPLOAD_FILENAME = 'upload';
const DEFAULT_UPLOAD_CONTENT_TYPE = 'application/octet-stream';
const MULTIPART_FILE_DESCRIPTOR_KEYS = new Set(['content', 'filename', 'contentType']);
// base64 (standard or URL-safe alphabet), whitespace allowed around the value
const BASE64_PATTERN = /^[A-Za-z0-9+/\-_]+={0,2}$/;

function decodeBase64FileContents(fieldName: string, value: string): Buffer {
  const compact = value.replace(/\s+/g, '');
  if (!BASE64_PATTERN.test(compact)) {
    throw new Error(
      `Multipart field '${fieldName}' must be a base64-encoded string of the file contents`,
    );
  }
  const buffer = Buffer.from(compact, 'base64');
  if (buffer.length === 0) {
    throw new Error(
      `Multipart field '${fieldName}' does not contain any decodable base64 file contents`,
    );
  }
  return buffer;
}

function appendMultipartField(
  parts: MultipartPart[],
  name: string,
  value: unknown,
  isBinaryField: boolean,
): void {
  if (value === undefined || value === null) {
    return;
  }

  // Arrays expand into repeated parts, matching how form fields repeat keys.
  if (Array.isArray(value)) {
    for (const item of value) {
      appendMultipartField(parts, name, item, isBinaryField);
    }
    return;
  }

  if (isBinaryField) {
    let contents: string;
    let filename: string | undefined;
    let contentType: string | undefined;
    if (typeof value === 'string') {
      contents = value;
    } else if (
      typeof value === 'object' &&
      typeof (value as Record<string, unknown>).content === 'string'
    ) {
      const descriptor = value as Record<string, unknown>;
      contents = descriptor.content as string;
      if (typeof descriptor.filename === 'string') {
        filename = descriptor.filename;
      }
      if (typeof descriptor.contentType === 'string') {
        contentType = descriptor.contentType;
      }
    } else {
      throw new Error(
        `Multipart field '${name}' expects a base64-encoded string or an object {content, filename, contentType}`,
      );
    }
    parts.push({
      name,
      value: decodeBase64FileContents(name, contents),
      filename: filename ?? DEFAULT_UPLOAD_FILENAME,
      contentType: contentType ?? DEFAULT_UPLOAD_CONTENT_TYPE,
    });
    return;
  }

  // Defensive: honor explicit file descriptors even when the spec did not mark
  // the field binary, then fall back to text serialization.
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (
      typeof record.content === 'string' &&
      Object.keys(record).every((key) => MULTIPART_FILE_DESCRIPTOR_KEYS.has(key))
    ) {
      appendMultipartField(parts, name, value, true);
      return;
    }
    parts.push({ name, value: JSON.stringify(record) });
    return;
  }

  parts.push({ name, value: String(value) });
}

export function buildMultipartParts(
  bodyValue: unknown,
  schema?: OpenAPIV3.SchemaObject,
): MultipartPart[] {
  if (!bodyValue || typeof bodyValue !== 'object' || Array.isArray(bodyValue)) {
    throw new Error('multipart/form-data request body must be provided as an object of form fields');
  }

  const properties = schema?.properties as Record<string, OpenAPIV3.SchemaObject> | undefined;
  const isBinaryField = (name: string): boolean => {
    const propertySchema = properties?.[name];
    // Multipart arrays use the item schema to determine each repeated part's type.
    const partSchema = propertySchema?.type === 'array' ? propertySchema.items : propertySchema;
    return (
      !!partSchema &&
      'type' in partSchema &&
      partSchema.type === 'string' &&
      partSchema.format === 'binary'
    );
  };

  const parts: MultipartPart[] = [];
  for (const [name, value] of Object.entries(bodyValue as Record<string, unknown>)) {
    appendMultipartField(parts, name, value, isBinaryField(name));
  }
  return parts;
}

// Quotes/newlines in part names or filenames would corrupt the multipart
// framing; replace them rather than trusting upstream spec names.
function sanitizeHeaderToken(token: string): string {
  return token.replace(/[\r\n"]/g, '_');
}

export function serializeMultipartBody(parts: MultipartPart[], boundary: string): Buffer {
  const chunks: Buffer[] = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`, 'utf8'));
    if (part.filename !== undefined) {
      chunks.push(
        Buffer.from(
          `Content-Disposition: form-data; name="${sanitizeHeaderToken(part.name)}"; filename="${sanitizeHeaderToken(part.filename)}"\r\n`,
          'utf8',
        ),
      );
      chunks.push(
        Buffer.from(`Content-Type: ${part.contentType ?? DEFAULT_UPLOAD_CONTENT_TYPE}\r\n\r\n`, 'utf8'),
      );
      chunks.push(part.value as Buffer);
    } else {
      chunks.push(
        Buffer.from(`Content-Disposition: form-data; name="${sanitizeHeaderToken(part.name)}"\r\n\r\n`, 'utf8'),
      );
      chunks.push(Buffer.from(String(part.value), 'utf8'));
    }
    chunks.push(Buffer.from('\r\n', 'utf8'));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return Buffer.concat(chunks);
}

// Serializes an application/x-www-form-urlencoded body: arrays become repeated
// keys, nested objects are JSON-stringified, primitives use their string form.
export function encodeFormUrlEncoded(bodyValue: unknown): string {
  if (!bodyValue || typeof bodyValue !== 'object' || Array.isArray(bodyValue)) {
    throw new Error(
      'application/x-www-form-urlencoded request body must be provided as an object of form fields',
    );
  }

  const params = new URLSearchParams();
  const append = (key: string, value: unknown): void => {
    if (value === undefined || value === null) {
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        append(key, item);
      }
      return;
    }
    params.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  };
  for (const [key, value] of Object.entries(bodyValue as Record<string, unknown>)) {
    append(key, value);
  }
  return params.toString();
}
