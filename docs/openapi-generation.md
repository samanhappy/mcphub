# OpenAPI Generation for OpenWebUI Integration

MCPHub now supports generating OpenAPI 3.0.3 specifications from MCP tools, enabling seamless integration with OpenWebUI and other OpenAPI-compatible systems without requiring MCPO as an intermediary proxy.

## Features

- ✅ **Automatic OpenAPI Generation**: Converts MCP tools to OpenAPI 3.0.3 specification
- ✅ **OpenWebUI Compatible**: Direct integration without MCPO proxy
- ✅ **Real-time Tool Discovery**: Dynamically includes tools from connected MCP servers
- ✅ **Dual Parameter Support**: Supports both GET (query params) and POST (JSON body) for tool execution
- ✅ **No Authentication Required**: OpenAPI endpoints are public for easy integration
- ✅ **Comprehensive Metadata**: Full OpenAPI specification with proper schemas and documentation

## Endpoints

### OpenAPI Specification
```
GET /api/openapi.json
```
Generates and returns the complete OpenAPI 3.0.3 specification for all connected MCP tools.

**Query Parameters:**
- `title` (optional): Custom API title
- `description` (optional): Custom API description
- `version` (optional): Custom API version
- `serverUrl` (optional): Custom server URL
- `includeDisabled` (optional): Include disabled tools (default: false)
- `servers` (optional): Comma-separated list of server names to include

**Example:**
```bash
curl "http://localhost:3000/api/openapi.json?title=My MCP API&version=2.0.0"
```

### Available Servers
```
GET /api/openapi/servers
```
Returns a list of connected MCP server names.

**Example Response:**
```json
{
  "success": true,
  "data": ["amap", "playwright", "slack"]
}
```

### Tool Statistics
```
GET /api/openapi/stats
```
Returns statistics about available tools and servers.

**Example Response:**
```json
{
  "success": true,
  "data": {
    "totalServers": 3,
    "totalTools": 41,
    "serverBreakdown": [
      {"name": "amap", "toolCount": 12, "status": "connected"},
      {"name": "playwright", "toolCount": 21, "status": "connected"},
      {"name": "slack", "toolCount": 8, "status": "connected"}
    ]
  }
}
```

### Tool Execution
```
GET|POST /api/tools/{serverName}/{toolName}
```
Execute MCP tools via OpenAPI-compatible endpoints.

**Examples:**
```bash
# GET request with query parameters (for simple tools)
curl "http://localhost:3000/api/tools/amap/amap-maps_weather?city=Beijing"

# POST request with JSON body (for complex tools)
curl -X POST "http://localhost:3000/api/tools/playwright/playwright-browser_navigate" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'
```

## OpenWebUI Integration

To integrate MCPHub with OpenWebUI:

1. **Start MCPHub** with your MCP servers configured
2. **Get the OpenAPI specification**:
   ```bash
   curl http://localhost:3000/api/openapi.json > mcphub-api.json
   ```
3. **Add to OpenWebUI** by importing the OpenAPI specification file or pointing to the URL directly

### Configuration Example

In OpenWebUI, you can add MCPHub as an OpenAPI tool by using:
- **OpenAPI URL**: `http://localhost:3000/api/openapi.json`
- **Base URL**: `http://localhost:3000/api`

## Generated OpenAPI Structure

The generated OpenAPI specification includes:

### Tool Conversion Logic
- **Simple tools** (≤10 primitive parameters) → GET endpoints with query parameters
- **Complex tools** (objects, arrays, or >10 parameters) → POST endpoints with JSON request body
- **All tools** include comprehensive response schemas and error handling

### Example Generated Operation
```yaml
/tools/amap/amap-maps_weather:
  get:
    summary: "根据城市名称或者标准adcode查询指定城市的天气"
    operationId: "amap_amap-maps_weather"
    tags: ["amap"]
    parameters:
      - name: city
        in: query
        required: true
        description: "城市名称或者adcode"
        schema:
          type: string
    responses:
      '200':
        description: "Successful tool execution"
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/ToolResponse'
```

### Security
- Bearer authentication is defined but not enforced for tool execution endpoints
- Enables flexible integration with various OpenAPI-compatible systems

## Benefits over MCPO

1. **Direct Integration**: No need for intermediate proxy
2. **Real-time Updates**: OpenAPI spec updates automatically as MCP servers connect/disconnect
3. **Better Performance**: Direct tool execution without proxy overhead
4. **Simplified Architecture**: One less component to manage
5. **Enhanced Features**: Statistics, server filtering, and flexible parameter handling

## Troubleshooting

**Q: OpenAPI spec shows no tools**
A: Ensure MCP servers are connected. Check `/api/openapi/stats` for server status.

**Q: Tool execution fails**
A: Verify the tool name and parameters match the OpenAPI specification. Check server logs for details.

**Q: OpenWebUI can't connect**
A: Ensure MCPHub is accessible from OpenWebUI and the OpenAPI URL is correct.

**Q: Missing tools in specification**
A: Check if tools are enabled in your MCP server configuration. Use `includeDisabled=true` to see all tools.