# OpenAPI Support in MCPHub

MCPHub now supports OpenAPI 3.1.1 servers as a new server type, allowing you to integrate REST APIs directly into your MCP workflow.

## Features

- ✅ **Full OpenAPI 3.1.1 Support**: Load and parse OpenAPI specifications
- ✅ **Multiple Security Types**: None, API Key, HTTP Authentication, OAuth 2.0, OpenID Connect
- ✅ **Dynamic Tool Generation**: Automatically creates MCP tools from OpenAPI operations
- ✅ **Type Safety**: Full TypeScript support with proper type definitions
- ✅ **Frontend Integration**: Easy-to-use forms for configuring OpenAPI servers
- ✅ **Internationalization**: Support for English and Chinese languages

## Configuration

### Basic Configuration

```json
{
  "type": "openapi",
  "openapi": {
    "url": "https://api.example.com/v1/openapi.json",
    "version": "3.1.0",
    "security": {
      "type": "none"
    }
  }
}
```

### With API Key Authentication

```json
{
  "type": "openapi",
  "openapi": {
    "url": "https://api.example.com/v1/openapi.json",
    "version": "3.1.0",
    "security": {
      "type": "apiKey",
      "apiKey": {
        "name": "X-API-Key",
        "in": "header",
        "value": "your-api-key-here"
      }
    }
  },
  "headers": {
    "Accept": "application/json"
  }
}
```

### With HTTP Bearer Authentication

```json
{
  "type": "openapi",
  "openapi": {
    "url": "https://api.example.com/v1/openapi.json",
    "version": "3.1.0",
    "security": {
      "type": "http",
      "http": {
        "scheme": "bearer",
        "credentials": "your-bearer-token-here"
      }
    }
  }
}
```

## Supported Security Types

1. **None**: No authentication required
2. **API Key**: API key in header or query parameter
3. **HTTP**: Basic, Bearer, or Digest authentication
4. **OAuth 2.0**: OAuth 2.0 access tokens
5. **OpenID Connect**: OpenID Connect ID tokens

## How It Works

1. **Specification Loading**: The OpenAPI client fetches and parses the OpenAPI specification
2. **Tool Generation**: Each operation in the spec becomes an MCP tool
3. **Request Handling**: Tools handle parameter validation and API calls
4. **Response Processing**: API responses are returned as tool results

## Frontend Usage

1. Navigate to the Servers page
2. Click "Add Server"
3. Select "OpenAPI" as the server type
4. Enter the OpenAPI specification URL
5. Configure security settings if needed
6. Add any additional headers
7. Save the configuration

## Testing

You can test the OpenAPI integration using the provided test scripts:

```bash
# Test OpenAPI client directly
npx tsx test-openapi.ts

# Test full integration
npx tsx test-integration.ts
```

## Example: Swagger Petstore

The Swagger Petstore API is a perfect example for testing:

```json
{
  "type": "openapi",
  "openapi": {
    "url": "https://petstore3.swagger.io/api/v3/openapi.json",
    "version": "3.1.0",
    "security": {
      "type": "none"
    }
  }
}
```

This will create tools like:

- `addPet`: Add a new pet to the store
- `findPetsByStatus`: Find pets by status
- `getPetById`: Find pet by ID
- And many more...

## Error Handling

The OpenAPI client includes comprehensive error handling:

- Network errors are properly caught and reported
- Invalid specifications are rejected with clear error messages
- API errors include response status and body information
- Type validation ensures proper parameter handling

## Limitations

- Only supports OpenAPI 3.x specifications (3.0.0 and above)
- Complex authentication flows (like OAuth 2.0 authorization code flow) require manual token management
- Large specifications may take time to parse initially
- Some advanced OpenAPI features may not be fully supported

## Contributing

To add new features or fix bugs in the OpenAPI integration:

1. Backend types: `src/types/index.ts`
2. OpenAPI client: `src/clients/openapi.ts`
3. Service integration: `src/services/mcpService.ts`
4. Frontend forms: `frontend/src/components/ServerForm.tsx`
5. Internationalization: `frontend/src/locales/`

## Troubleshooting

**Q: My OpenAPI server won't connect**
A: Check that the specification URL is accessible and returns valid JSON/YAML

**Q: Tools aren't showing up**
A: Verify that your OpenAPI specification includes valid operations with required fields

**Q: Authentication isn't working**
A: Double-check your security configuration matches the API's requirements

**Q: Getting CORS errors**
A: The API server needs to allow CORS requests from your MCPHub domain
