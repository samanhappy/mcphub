# Environment Variable Expansion in mcp_settings.json

## Overview

MCPHub now supports comprehensive environment variable expansion throughout the entire `mcp_settings.json` configuration file. This allows you to externalize sensitive information and configuration values, making your setup more secure and flexible.

## Supported Formats

MCPHub supports two environment variable formats:

1. **${VAR}** - Standard format (recommended)
2. **$VAR** - Unix-style format (variable name must start with an uppercase letter or underscore, followed by uppercase letters, numbers, or underscores)

## What Can Be Expanded

Environment variables can now be used in **ANY** string value throughout your configuration:

- Server URLs
- Commands and arguments
- Headers
- Environment variables passed to child processes
- OpenAPI specifications and security configurations
- OAuth credentials
- System configuration values
- Any other string fields

## Examples

### 1. SSE/HTTP Server Configuration

```json
{
  "mcpServers": {
    "my-api-server": {
      "type": "sse",
      "url": "${MCP_SERVER_URL}",
      "headers": {
        "Authorization": "Bearer ${API_TOKEN}",
        "X-Custom-Header": "${CUSTOM_VALUE}"
      }
    }
  }
}
```

Environment variables:
```bash
export MCP_SERVER_URL="https://api.example.com/mcp"
export API_TOKEN="secret-token-123"
export CUSTOM_VALUE="my-custom-value"
```

### 2. Stdio Server Configuration

```json
{
  "mcpServers": {
    "my-python-server": {
      "type": "stdio",
      "command": "${PYTHON_PATH}",
      "args": ["-m", "${MODULE_NAME}", "--api-key", "${API_KEY}"],
      "env": {
        "DATABASE_URL": "${DATABASE_URL}",
        "DEBUG": "${DEBUG_MODE}"
      }
    }
  }
}
```

Environment variables:
```bash
export PYTHON_PATH="/usr/bin/python3"
export MODULE_NAME="my_mcp_server"
export API_KEY="secret-api-key"
export DATABASE_URL="postgresql://localhost/mydb"
export DEBUG_MODE="true"
```

### 3. OpenAPI Server Configuration

```json
{
  "mcpServers": {
    "openapi-service": {
      "type": "openapi",
      "openapi": {
        "url": "${OPENAPI_SPEC_URL}",
        "security": {
          "type": "apiKey",
          "apiKey": {
            "name": "X-API-Key",
            "in": "header",
            "value": "${OPENAPI_API_KEY}"
          }
        }
      }
    }
  }
}
```

Environment variables:
```bash
export OPENAPI_SPEC_URL="https://api.example.com/openapi.json"
export OPENAPI_API_KEY="your-api-key-here"
```

### 4. OAuth Configuration

```json
{
  "mcpServers": {
    "oauth-server": {
      "type": "sse",
      "url": "${OAUTH_SERVER_URL}",
      "oauth": {
        "clientId": "${OAUTH_CLIENT_ID}",
        "clientSecret": "${OAUTH_CLIENT_SECRET}",
        "accessToken": "${OAUTH_ACCESS_TOKEN}"
      }
    }
  }
}
```

Environment variables:
```bash
export OAUTH_SERVER_URL="https://oauth.example.com/mcp"
export OAUTH_CLIENT_ID="my-client-id"
export OAUTH_CLIENT_SECRET="my-client-secret"
export OAUTH_ACCESS_TOKEN="my-access-token"
```

### 5. System Configuration

```json
{
  "systemConfig": {
    "install": {
      "pythonIndexUrl": "${PYTHON_INDEX_URL}",
      "npmRegistry": "${NPM_REGISTRY}"
    },
    "mcpRouter": {
      "apiKey": "${MCPROUTER_API_KEY}",
      "referer": "${MCPROUTER_REFERER}"
    }
  }
}
```

Environment variables:
```bash
export PYTHON_INDEX_URL="https://pypi.tuna.tsinghua.edu.cn/simple"
export NPM_REGISTRY="https://registry.npmmirror.com"
export MCPROUTER_API_KEY="router-api-key"
export MCPROUTER_REFERER="https://myapp.com"
```

## Complete Example

See [examples/mcp_settings_with_env_vars.json](../examples/mcp_settings_with_env_vars.json) for a comprehensive example configuration using environment variables.

## Best Practices

### Security

1. **Never commit sensitive values to version control** - Use environment variables for all secrets
2. **Use .env files for local development** - MCPHub automatically loads `.env` files
3. **Use secure secret management in production** - Consider using Docker secrets, Kubernetes secrets, or cloud provider secret managers

### Organization

1. **Group related variables** - Use prefixes for related configuration (e.g., `API_`, `DB_`, `OAUTH_`)
2. **Document required variables** - Maintain a list of required environment variables in your README
3. **Provide example .env file** - Create a `.env.example` file with placeholder values

### Example .env File

```bash
# Server Configuration
MCP_SERVER_URL=https://api.example.com/mcp
API_TOKEN=your-api-token-here

# Python Server
PYTHON_PATH=/usr/bin/python3
MODULE_NAME=my_mcp_server

# Database
DATABASE_URL=postgresql://localhost/mydb

# OpenAPI
OPENAPI_SPEC_URL=https://api.example.com/openapi.json
OPENAPI_API_KEY=your-openapi-key

# OAuth
OAUTH_CLIENT_ID=your-client-id
OAUTH_CLIENT_SECRET=your-client-secret
OAUTH_ACCESS_TOKEN=your-access-token
```

## Docker Usage

When using Docker, pass environment variables using `-e` flag or `--env-file`:

```bash
# Using individual variables
docker run -e API_TOKEN=secret -e SERVER_URL=https://api.example.com mcphub

# Using env file
docker run --env-file .env mcphub
```

Or in docker-compose.yml:

```yaml
version: '3.8'
services:
  mcphub:
    image: mcphub
    env_file:
      - .env
    environment:
      - MCP_SERVER_URL=${MCP_SERVER_URL}
      - API_TOKEN=${API_TOKEN}
```

## Troubleshooting

### Variable Not Expanding

If a variable is not expanding:

1. Check that the variable is set: `echo $VAR_NAME`
2. Verify the variable name matches exactly (case-sensitive)
3. Ensure the variable is exported: `export VAR_NAME=value`
4. Restart MCPHub after setting environment variables

### Empty Values

If an environment variable is not set, it will be replaced with an empty string. Make sure all required variables are set before starting MCPHub.

### Nested Variables

Environment variables in nested objects and arrays are fully supported:

```json
{
  "nested": {
    "deep": {
      "value": "${MY_VAR}"
    }
  },
  "array": ["${VAR1}", "${VAR2}"]
}
```

## Migration from Previous Version

If you were previously using environment variables only in headers, no changes are needed. The new implementation is backward compatible and simply extends support to all configuration fields.

## Technical Details

- Environment variables are expanded once when the configuration is loaded
- Expansion is recursive and handles nested objects and arrays
- Non-string values (booleans, numbers, null) are preserved as-is
- Empty string is used when an environment variable is not set
