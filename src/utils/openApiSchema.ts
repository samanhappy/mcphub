/**
 * Convert schema fragments between MCP JSON Schema and OpenAPI 3.0.x.
 */

type Schema = Record<string, any>;

/** Convert a JSON-safe OpenAPI input schema without rewriting example/default data. */
export function fromOpenApiSchema(schema: unknown): any {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    return schema;
  }

  const { nullable, ...result } = schema as Schema;
  // OpenAPI 3.0 nullable only extends an explicit type; other constraints still apply.
  if (nullable === true && typeof result.type === 'string') {
    result.type = result.type === 'null' ? ['null'] : [result.type, 'null'];
  }
  for (const [key, value] of Object.entries(result)) {
    if (key === 'properties' && value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = Object.fromEntries(
        Object.entries(value).map(([name, property]) => [name, fromOpenApiSchema(property)]),
      );
    } else if (['items', 'additionalProperties', 'not'].includes(key)) {
      result[key] = fromOpenApiSchema(value);
    } else if (['allOf', 'anyOf', 'oneOf'].includes(key) && Array.isArray(value)) {
      result[key] = value.map(fromOpenApiSchema);
    }
  }
  return result;
}

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
    const acceptsNull = types.length !== result.type.length;
    if (types.length === 0) {
      delete result.type;
    } else if (types.length === 1) {
      result.type = types[0];
      if (acceptsNull) {
        result.nullable = true;
      }
    } else {
      delete result.type;
      const members: Schema[] = types.map((type: unknown) => ({ type }));
      if (acceptsNull) {
        members[0] = markNullable(members[0], false);
      }
      if (result.anyOf === undefined) {
        result.anyOf = members;
      } else {
        result.allOf = [...(result.allOf ?? []), { anyOf: members }];
      }
    }
  }

  for (const key of ['anyOf', 'oneOf']) {
    if (!Array.isArray(result[key]) || !result[key].some(isNullSchema)) continue;
    const members = result[key].filter((member: unknown) => !isNullSchema(member));
    delete result[key];
    if (members.length === 1) {
      // The node's own keywords (description, default, ...) take priority over the member's
      Object.assign(result, { ...members[0], ...result });
      nullable = true;
    } else if (members.length > 1) {
      // `nullable` must sit next to a `type`, so it goes on the first member that has one. One
      // member is enough for anyOf, and for oneOf null has to match exactly one member
      const typed = members.findIndex(
        (member: unknown) => !!member && typeof (member as Schema).type === 'string',
      );
      if (typed >= 0) {
        members[typed] = markNullable(members[typed]);
      } else {
        nullable = true;
      }
      result[key] = members;
    } else {
      nullable = true;
    }
  }

  return nullable ? markNullable(result) : result;
}

/**
 * Make a schema accept null in OpenAPI 3.0. `nullable` only counts next to a `type`, and an
 * `enum` accepts null only when it lists it. `extendEnum` is false when the schema's own enum
 * is meant to keep excluding null.
 */
function markNullable(schema: Schema, extendEnum = true): Schema {
  const marked: Schema = { ...schema };
  const hasEnum = Array.isArray(marked.enum);
  if (hasEnum && extendEnum && !marked.enum.includes(null)) {
    marked.enum = [...marked.enum, null];
  }
  if (typeof marked.type === 'string' || !hasEnum) {
    marked.nullable = true;
  }
  return marked;
}
