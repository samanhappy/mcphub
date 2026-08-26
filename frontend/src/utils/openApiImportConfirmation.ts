interface OpenApiImportInput {
  inputMode?: 'url' | 'schema';
  url?: string;
  schema?: string;
}

export function shouldConfirmOpenApiImport(
  serverType: string,
  openapi?: OpenApiImportInput,
): boolean {
  if (serverType !== 'openapi') {
    return false;
  }

  const source = openapi?.inputMode === 'schema' ? openapi.schema : openapi?.url;
  return Boolean(source?.trim());
}
