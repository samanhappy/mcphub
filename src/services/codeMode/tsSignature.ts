/**
 * Generates a concise TypeScript call signature from an MCP tool's JSON Schema `inputSchema`
 * so models using Code Mode (`execute_code`) can write accurate `tools.call(...)` invocations.
 */

const MAX_DEPTH = 4;
const MAX_PROPERTIES = 25;

const formatPropertyKey = (key: string): string =>
  /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);

const formatLiteral = (value: unknown): string => {
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }
  return 'unknown';
};

const schemaToTypeScript = (schema: unknown, depth: number): string => {
  if (!schema || typeof schema !== 'object') {
    return 'unknown';
  }

  const s = schema as Record<string, unknown>;

  if ('const' in s) {
    return formatLiteral(s.const);
  }

  if (Array.isArray(s.enum) && s.enum.length > 0) {
    return s.enum.map(formatLiteral).join(' | ');
  }

  for (const combiner of ['oneOf', 'anyOf'] as const) {
    if (Array.isArray(s[combiner]) && (s[combiner] as unknown[]).length > 0) {
      if (depth >= MAX_DEPTH) return 'unknown';
      const parts = (s[combiner] as unknown[]).map((sub) => schemaToTypeScript(sub, depth + 1));
      return Array.from(new Set(parts)).join(' | ');
    }
  }

  if (Array.isArray(s.allOf) && s.allOf.length > 0) {
    if (depth >= MAX_DEPTH) return 'unknown';
    const parts = (s.allOf as unknown[]).map((sub) => schemaToTypeScript(sub, depth + 1));
    return Array.from(new Set(parts)).join(' & ');
  }

  if (Array.isArray(s.type)) {
    const types = s.type.map((t) => schemaToTypeScript({ ...s, type: t }, depth));
    return Array.from(new Set(types)).join(' | ');
  }

  const type = typeof s.type === 'string' ? s.type : s.properties ? 'object' : s.items ? 'array' : undefined;

  switch (type) {
    case 'string':
      return 'string';
    case 'number':
    case 'integer':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'null':
      return 'null';
    case 'array': {
      if (depth >= MAX_DEPTH) return 'unknown[]';
      const itemType = s.items ? schemaToTypeScript(s.items, depth + 1) : 'unknown';
      return itemType.includes(' | ') || itemType.includes(' & ')
        ? `(${itemType})[]`
        : `${itemType}[]`;
    }
    case 'object': {
      if (depth >= MAX_DEPTH) return 'Record<string, unknown>';
      const properties =
        s.properties && typeof s.properties === 'object'
          ? (s.properties as Record<string, unknown>)
          : undefined;
      if (!properties || Object.keys(properties).length === 0) {
        if (s.additionalProperties && typeof s.additionalProperties === 'object') {
          return `Record<string, ${schemaToTypeScript(s.additionalProperties, depth + 1)}>`;
        }
        return 'Record<string, unknown>';
      }

      const required = new Set(Array.isArray(s.required) ? s.required.map(String) : []);
      const entries = Object.entries(properties);
      const visible = entries.slice(0, MAX_PROPERTIES);
      const fields = visible.map(([key, propSchema]) => {
        const opt = required.has(key) ? '' : '?';
        return `${formatPropertyKey(key)}${opt}: ${schemaToTypeScript(propSchema, depth + 1)}`;
      });

      if (entries.length > MAX_PROPERTIES) {
        fields.push(`[key: string]: unknown`);
      } else if (s.additionalProperties === true) {
        fields.push(`[key: string]: unknown`);
      } else if (s.additionalProperties && typeof s.additionalProperties === 'object') {
        fields.push(`[key: string]: ${schemaToTypeScript(s.additionalProperties, depth + 1)}`);
      }

      return `{ ${fields.join('; ')} }`;
    }
    default:
      return 'unknown';
  }
};

export const generateToolTypeScriptSignature = (
  toolName: string,
  inputSchema: unknown,
): string => {
  const argsType = schemaToTypeScript(inputSchema, 0);
  const hasRequired =
    Boolean(
      inputSchema &&
        typeof inputSchema === 'object' &&
        Array.isArray((inputSchema as Record<string, unknown>).required) &&
        ((inputSchema as Record<string, unknown>).required as unknown[]).length > 0,
    );
  const hasProperties =
    Boolean(
      inputSchema &&
        typeof inputSchema === 'object' &&
        (inputSchema as Record<string, unknown>).properties &&
        typeof (inputSchema as Record<string, unknown>).properties === 'object' &&
        Object.keys((inputSchema as Record<string, unknown>).properties as Record<string, unknown>)
          .length > 0,
    );

  if (!hasProperties && !hasRequired && argsType === 'Record<string, unknown>') {
    return `await tools.call(${JSON.stringify(toolName)}, args?: Record<string, unknown>): Promise<unknown>`;
  }

  return `await tools.call(${JSON.stringify(toolName)}, args${hasRequired ? '' : '?'}: ${argsType}): Promise<unknown>`;
};
