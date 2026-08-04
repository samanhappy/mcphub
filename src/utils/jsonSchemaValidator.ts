import { AjvJsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/ajv-provider.js';
import type {
  jsonSchemaValidator,
  JsonSchemaType,
  JsonSchemaValidatorResult,
} from '@modelcontextprotocol/sdk/validation/types.js';

/**
 * Validator that tolerates schemas AJV cannot compile (e.g. an unresolvable
 * $ref such as `#/$defs/ScreenInstance` with no matching `$defs` in scope).
 *
 * The MCP SDK pre-compiles a validator for every tool outputSchema during
 * tools/list. The default AjvJsonSchemaValidator throws on an unresolvable
 * $ref, which would fail discovery for the whole server. This wrapper keeps
 * strict validation for well-formed schemas and only degrades the offending
 * schema to a passthrough (skip output validation) instead of throwing.
 */
export class ResilientJsonSchemaValidator implements jsonSchemaValidator {
  private readonly delegate = new AjvJsonSchemaValidator();

  getValidator<T>(schema: JsonSchemaType): (input: unknown) => JsonSchemaValidatorResult<T> {
    try {
      return this.delegate.getValidator<T>(schema);
    } catch {
      // Uncompilable schema: accept any output rather than fail tool discovery.
      return (input: unknown) => ({ valid: true, data: input as T, errorMessage: undefined });
    }
  }
}
