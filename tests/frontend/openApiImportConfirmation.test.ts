import { shouldConfirmOpenApiImport } from '../../frontend/src/utils/openApiImportConfirmation';

describe('shouldConfirmOpenApiImport', () => {
  it('requires confirmation for an OpenAPI URL import', () => {
    expect(
      shouldConfirmOpenApiImport('openapi', {
        inputMode: 'url',
        url: 'https://example.com/openapi.json',
      }),
    ).toBe(true);
  });

  it('requires confirmation for an inline OpenAPI schema import', () => {
    expect(
      shouldConfirmOpenApiImport('openapi', { inputMode: 'schema', schema: '{"openapi":"3.0.0"}' }),
    ).toBe(true);
  });

  it('does not require confirmation for other server types or empty input', () => {
    expect(
      shouldConfirmOpenApiImport('sse', { inputMode: 'url', url: 'https://example.com/sse' }),
    ).toBe(false);
    expect(shouldConfirmOpenApiImport('openapi', { inputMode: 'url', url: '   ' })).toBe(false);
    expect(shouldConfirmOpenApiImport('openapi', { inputMode: 'schema', schema: '   ' })).toBe(
      false,
    );
  });
});
