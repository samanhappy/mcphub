/**
 * Convert JSON Schema fragments from MCP tool input schemas into schemas that are valid
 * under OpenAPI 3.0.x (which the generated documents declare).
 */

type Schema = Record<string, any>;

const DEFINITION_PREFIXES = ['#/$defs/', '#/definitions/'];

function definitionName(ref: string): string | undefined {
  const prefix = DEFINITION_PREFIXES.find((candidate) => ref.startsWith(candidate));
  return prefix ? ref.slice(prefix.length) : undefined;
}

function isNullSchema(member: unknown): boolean {
  return !!member && typeof member === 'object' && (member as Schema).type === 'null';
}

/**
 * Collect the local definitions of a tool input schema, keyed by name.
 */
export function collectDefinitions(rootSchema: Schema): Record<string, Schema> {
  return { ...rootSchema.definitions, ...rootSchema.$defs };
}

/**
 * Rewrite a schema for OpenAPI 3.0:
 * - `type: [..., 'null']` and `anyOf`/`oneOf` members of `{ type: 'null' }` become `nullable: true`
 * - other `type` lists become an `anyOf`
 * - `const` becomes a single-value `enum`
 * - local `$ref`s to `$defs`/`definitions` are inlined, since the root definitions are not part
 *   of the generated document. A reference to a definition that is already being inlined
 *   (a recursive schema) becomes an empty schema, which accepts any value.
 */
export function toOpenApiSchema(
  schema: unknown,
  definitions: Record<string, Schema> = {},
  resolving: readonly string[] = [],
): any {
  if (Array.isArray(schema)) {
    return schema.map((item) => toOpenApiSchema(item, definitions, resolving));
  }
  if (!schema || typeof schema !== 'object') {
    return schema;
  }

  const { $ref, $defs: _defs, definitions: _definitions, ...rest } = schema as Schema;
  const node = convertChildren(rest, definitions, resolving);

  if (typeof $ref === 'string') {
    const name = definitionName($ref);
    if (name !== undefined && Object.prototype.hasOwnProperty.call(definitions, name)) {
      const target = resolving.includes(name)
        ? {}
        : toOpenApiSchema(definitions[name], definitions, [...resolving, name]);
      return normalizeNullability({ ...target, ...node });
    }
    // Not a reference this converter can resolve; keep it as written
    return { $ref, ...node };
  }

  return normalizeNullability(node);
}

function convertChildren(
  node: Schema,
  definitions: Record<string, Schema>,
  resolving: readonly string[],
): Schema {
  const converted: Schema = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      converted.properties = Object.fromEntries(
        Object.entries(value).map(([name, property]) => [
          name,
          toOpenApiSchema(property, definitions, resolving),
        ]),
      );
    } else if (['items', 'additionalProperties', 'not'].includes(key)) {
      converted[key] = toOpenApiSchema(value, definitions, resolving);
    } else if (['allOf', 'anyOf', 'oneOf'].includes(key) && Array.isArray(value)) {
      converted[key] = toOpenApiSchema(value, definitions, resolving);
    } else {
      converted[key] = value;
    }
  }
  return converted;
}

function normalizeNullability(node: Schema): Schema {
  const result: Schema = { ...node };
  let nullable = false;

  if (result.const !== undefined && result.enum === undefined) {
    result.enum = [result.const];
    delete result.const;
  }

  if (Array.isArray(result.type)) {
    const types = result.type.filter((type: unknown) => type !== 'null');
    nullable = types.length !== result.type.length;
    if (types.length === 0) {
      delete result.type;
    } else if (types.length === 1) {
      result.type = types[0];
    } else {
      delete result.type;
      const union = { anyOf: types.map((type: unknown) => ({ type })) };
      if (result.anyOf === undefined) {
        result.anyOf = union.anyOf;
      } else {
        result.allOf = [...(result.allOf ?? []), union];
      }
    }
  }

  for (const key of ['anyOf', 'oneOf']) {
    if (!Array.isArray(result[key]) || !result[key].some(isNullSchema)) continue;
    nullable = true;
    const members = result[key].filter((member: unknown) => !isNullSchema(member));
    delete result[key];
    if (members.length === 1) {
      // The node's own keywords (description, default, ...) take priority over the member's
      Object.assign(result, { ...members[0], ...result });
    } else if (members.length > 1) {
      result[key] = members;
    }
  }

  if (nullable) {
    result.nullable = true;
  }
  return result;
}
