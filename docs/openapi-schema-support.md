# OpenAPI Schema Support in MCPHub

MCPHub now supports both OpenAPI specification URLs and complete JSON schemas for OpenAPI server configuration. This allows you to either reference an external OpenAPI specification file or embed the complete schema directly in your configuration.

## Configuration Options

### 1. Using OpenAPI Specification URL (Traditional)

```json
{
  "type": "openapi",
  "openapi": {
    "url": "https://api.example.com/openapi.json",
    "version": "3.1.0",
    "security": {
      "type": "apiKey",
      "apiKey": {
        "name": "X-API-Key",
        "in": "header",
        "value": "your-api-key"
      }
    }
  }
}
```

### 2. Using Complete JSON Schema (New)

```json
{
  "type": "openapi",
  "openapi": {
    "schema": {
      "openapi": "3.1.0",
      "info": {
        "title": "My API",
        "version": "1.0.0"
      },
      "servers": [
        {
          "url": "https://api.example.com"
        }
      ],
      "paths": {
        "/users": {
          "get": {
            "operationId": "getUsers",
            "summary": "Get all users",
            "responses": {
              "200": {
                "description": "List of users"
              }
            }
          }
        }
      }
    },
    "version": "3.1.0",
    "security": {
      "type": "apiKey",
      "apiKey": {
        "name": "X-API-Key",
        "in": "header",
        "value": "your-api-key"
      }
    }
  }
}
```

## Benefits of JSON Schema Support

1. **Offline Development**: No need for external URLs during development
2. **Version Control**: Schema changes can be tracked in your configuration
3. **Security**: No external dependencies or network calls required
4. **Customization**: Full control over the API specification
5. **Testing**: Easy to create test configurations with mock schemas

## Frontend Form Support

The web interface now includes:

- **Input Mode Selection**: Choose between "Specification URL" or "JSON Schema"
- **URL Input**: Traditional URL input field for external specifications
- **Schema Editor**: Large text area with syntax highlighting for JSON schema input
- **Validation**: Client-side JSON validation before submission
- **Help Text**: Contextual help for schema format

## API Validation

The backend validates that:

- At least one of `url` or `schema` is provided for OpenAPI servers
- JSON schemas are properly formatted when provided
- Security configurations are valid for both input modes
- All required OpenAPI fields are present

## Migration Guide

### From URL to Schema

If you want to convert an existing URL-based configuration to schema-based:

1. Download your OpenAPI specification from the URL
2. Copy the JSON content
3. Update your configuration to use the `schema` field instead of `url`
4. Paste the JSON content as the value of the `schema` field

### Maintaining Both

You can include both `url` and `schema` in your configuration. The system will prioritize the `schema` field if both are present.

## Examples

See the `examples/openapi-schema-config.json` file for complete configuration examples showing both URL and schema-based configurations.

## Technical Implementation

- **Backend**: OpenAPI client supports both SwaggerParser.dereference() with URLs and direct schema objects
- **Frontend**: Dynamic form rendering based on selected input mode
- **Validation**: Enhanced validation logic in server controllers
- **Type Safety**: Updated TypeScript interfaces for both input modes

## Security Considerations

When using JSON schemas:

- Ensure schemas are properly validated before use
- Be aware that large schemas increase configuration file size
- Consider using URL-based approach for frequently changing APIs
- Store sensitive information (like API keys) in environment variables, not in schemas

## Troubleshooting

### Common Issues

1. **Invalid JSON**: Ensure your schema is valid JSON format
2. **Missing Required Fields**: OpenAPI schemas must include `openapi`, `info`, and `paths` fields
3. **Schema Size**: Very large schemas may impact performance
4. **Server Configuration**: Ensure the `servers` field in your schema points to the correct endpoints

### Validation Errors

The system provides detailed error messages for:

- Malformed JSON in schema field
- Missing required OpenAPI fields
- Invalid security configurations
- Network issues with URL-based configurations
