import type {
  jsonSchemaValidator,
  JsonSchemaType,
  JsonSchemaValidatorResult,
} from '@modelcontextprotocol/server';
import { AjvJsonSchemaValidator } from '@modelcontextprotocol/server/validators/ajv';

/**
 * Validator that tolerates schemas AJV cannot compile (e.g. an unresolvable
 * $ref such as `#/$defs/ScreenInstance` with no matching `$defs` in scope).
 *
 * The MCP SDK compiles outputSchema validators when tools are called. The default
 * AjvJsonSchemaValidator throws on an unresolvable $ref, preventing the affected
 * tool from being called. This wrapper keeps
 * strict validation for well-formed schemas and only degrades the offending
 * schema to a passthrough (skip output validation) instead of throwing.
 */
export class ResilientJsonSchemaValidator implements jsonSchemaValidator {
  private readonly delegate = new AjvJsonSchemaValidator();

  getValidator<T>(schema: JsonSchemaType): (input: unknown) => JsonSchemaValidatorResult<T> {
    try {
      return this.delegate.getValidator<T>(schema);
    } catch {
      // Uncompilable schema: accept any output rather than block the tool call.
      return (input: unknown) => ({ valid: true, data: input as T, errorMessage: undefined });
    }
  }
}
