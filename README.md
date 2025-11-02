# MCPHub: The Unified Hub for Model Context Protocol (MCP) Servers

English | [Français](README.fr.md) | [中文版](README.zh.md)

MCPHub makes it easy to manage and scale multiple MCP (Model Context Protocol) servers by organizing them into flexible Streamable HTTP (SSE) endpoints—supporting access to all servers, individual servers, or logical server groups.

![Dashboard Preview](assets/dashboard.png)

## 🌐 Live Demo & Docs

- **Documentation**: [docs.mcphubx.com](https://docs.mcphubx.com/)
- **Demo Environment**: [demo.mcphubx.com](https://demo.mcphubx.com/)

## 🚀 Features

- **Broadened MCP Server Support**: Seamlessly integrate any MCP server with minimal configuration.
- **Centralized Dashboard**: Monitor real-time status and performance metrics from one sleek web UI.
- **Flexible Protocol Handling**: Full compatibility with both stdio and SSE MCP protocols.
- **Hot-Swappable Configuration**: Add, remove, or update MCP servers on the fly — no downtime required.
- **Group-Based Access Control**: Organize servers into customizable groups for streamlined permissions management.
- **Secure Authentication**: Built-in user management with role-based access powered by JWT and bcrypt.
- **OAuth 2.0 Support**: 
  - Full OAuth support for upstream MCP servers with proxy authorization capabilities
  - **NEW**: Act as OAuth 2.0 authorization server for external clients (ChatGPT Web, custom apps)
- **Environment Variable Expansion**: Use environment variables anywhere in your configuration for secure credential management. See [Environment Variables Guide](docs/environment-variables.md).
- **Docker-Ready**: Deploy instantly with our containerized setup.

## 🔧 Quick Start

### Configuration

Create a `mcp_settings.json` file to customize your server settings:

```json
{
  "mcpServers": {
    "amap": {
      "command": "npx",
      "args": ["-y", "@amap/amap-maps-mcp-server"],
      "env": {
        "AMAP_MAPS_API_KEY": "your-api-key"
      }
    },
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest", "--headless"]
    },
    "fetch": {
      "command": "uvx",
      "args": ["mcp-server-fetch"]
    },
    "slack": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-slack"],
      "env": {
        "SLACK_BOT_TOKEN": "your-bot-token",
        "SLACK_TEAM_ID": "your-team-id"
      }
    }
  }
}
```

#### OAuth Configuration (Optional)

MCPHub supports OAuth 2.0 for authenticating with upstream MCP servers. See the [OAuth feature guide](docs/features/oauth.mdx) for a full walkthrough. In practice you will run into two configuration patterns:

- **Dynamic registration servers** (e.g., Vercel, Linear) publish all metadata and allow MCPHub to self-register. Simply declare the server URL and MCPHub handles the rest.
- **Manually provisioned servers** (e.g., GitHub Copilot) require you to create an OAuth App and provide the issued client ID/secret to MCPHub.

Dynamic registration example:

```json
{
  "mcpServers": {
    "vercel": {
      "type": "sse",
      "url": "https://mcp.vercel.com"
    }
  }
}
```

Manual registration example:

```json
{
  "mcpServers": {
    "github": {
      "type": "sse",
      "url": "https://api.githubcopilot.com/mcp/",
      "oauth": {
        "clientId": "${GITHUB_OAUTH_APP_ID}",
        "clientSecret": "${GITHUB_OAUTH_APP_SECRET}"
      }
    }
  }
}
```

For manual providers, create the OAuth App in the upstream console, set the redirect URI to `http://localhost:3000/oauth/callback` (or your deployed domain), and then plug the credentials into the dashboard or config file.

#### OAuth Authorization Server (NEW)

MCPHub can now act as an OAuth 2.0 authorization server, allowing external applications to securely access your MCP servers using standard OAuth flows. This is particularly useful for integrating with ChatGPT Web and other services that require OAuth authentication.

**Enable OAuth Server:**

```json
{
  "systemConfig": {
    "oauthServer": {
      "enabled": true,
      "accessTokenLifetime": 3600,
      "refreshTokenLifetime": 1209600,
      "allowedScopes": ["read", "write"]
    }
  },
  "oauthClients": [
    {
      "clientId": "your-client-id",
      "name": "ChatGPT Web",
      "redirectUris": ["https://chatgpt.com/oauth/callback"],
      "grants": ["authorization_code", "refresh_token"],
      "scopes": ["read", "write"]
    }
  ]
}
```

**Key Features:**
- Standard OAuth 2.0 authorization code flow
- PKCE support for enhanced security
- Token refresh capabilities
- Compatible with ChatGPT Web and other OAuth clients

For detailed setup instructions, see the [OAuth Server Documentation](docs/oauth-server.md).

### Docker Deployment

**Recommended**: Mount your custom config:

```bash
docker run -p 3000:3000 -v ./mcp_settings.json:/app/mcp_settings.json -v ./data:/app/data samanhappy/mcphub
```

or run with default settings:

```bash
docker run -p 3000:3000 samanhappy/mcphub
```

### Access the Dashboard

Open `http://localhost:3000` and log in with your credentials.

> **Note**: Default credentials are `admin` / `admin123`.

**Dashboard Overview**:

- Live status of all MCP servers
- Enable/disable or reconfigure servers
- Group management for organizing servers
- User administration for access control

### Streamable HTTP Endpoint

> As of now, support for streaming HTTP endpoints varies across different AI clients. If you encounter issues, you can use the SSE endpoint or wait for future updates.

Connect AI clients (e.g., Claude Desktop, Cursor, DeepChat, etc.) via:

```
http://localhost:3000/mcp
```

This endpoint provides a unified streamable HTTP interface for all your MCP servers. It allows you to:

- Send requests to any configured MCP server
- Receive responses in real-time
- Easily integrate with various AI clients and tools
- Use the same endpoint for all servers, simplifying your integration process

**Smart Routing (Experimental)**:

Smart Routing is MCPHub's intelligent tool discovery system that uses vector semantic search to automatically find the most relevant tools for any given task.

```
# Search across all servers
http://localhost:3000/mcp/$smart

# Search within a specific group
http://localhost:3000/mcp/$smart/{group}
```

**How it Works:**

1. **Tool Indexing**: All MCP tools are automatically converted to vector embeddings and stored in PostgreSQL with pgvector
2. **Semantic Search**: User queries are converted to vectors and matched against tool embeddings using cosine similarity
3. **Intelligent Filtering**: Dynamic thresholds ensure relevant results without noise
4. **Precise Execution**: Found tools can be directly executed with proper parameter validation
5. **Group Scoping**: Optionally limit searches to servers within a specific group for focused results

**Setup Requirements:**

![Smart Routing](assets/smart-routing.png)

To enable Smart Routing, you need:

- PostgreSQL with pgvector extension
- OpenAI API key (or compatible embedding service)
- Enable Smart Routing in MCPHub settings

**Group-Scoped Smart Routing**:

You can combine Smart Routing with group filtering to search only within specific server groups:

```
# Search only within production servers
http://localhost:3000/mcp/$smart/production

# Search only within development servers
http://localhost:3000/mcp/$smart/development
```

This enables:
- **Focused Discovery**: Find tools only from relevant servers
- **Environment Isolation**: Separate tool discovery by environment (dev, staging, prod)
- **Team-Based Access**: Limit tool search to team-specific server groups

**Group-Specific Endpoints (Recommended)**:

![Group Management](assets/group.png)

For targeted access to specific server groups, use the group-based HTTP endpoint:

```
http://localhost:3000/mcp/{group}
```

Where `{group}` is the ID or name of the group you created in the dashboard. This allows you to:

- Connect to a specific subset of MCP servers organized by use case
- Isolate different AI tools to access only relevant servers
- Implement more granular access control for different environments or teams

**Server-Specific Endpoints**:
For direct access to individual servers, use the server-specific HTTP endpoint:

```
http://localhost:3000/mcp/{server}
```

Where `{server}` is the name of the server you want to connect to. This allows you to access a specific MCP server directly.

> **Note**: If the server name and group name are the same, the group name will take precedence.

### SSE Endpoint (Deprecated in Future)

Connect AI clients (e.g., Claude Desktop, Cursor, DeepChat, etc.) via:

```
http://localhost:3000/sse
```

For smart routing, use:

```
# Search across all servers
http://localhost:3000/sse/$smart

# Search within a specific group
http://localhost:3000/sse/$smart/{group}
```

For targeted access to specific server groups, use the group-based SSE endpoint:

```
http://localhost:3000/sse/{group}
```

For direct access to individual servers, use the server-specific SSE endpoint:

```
http://localhost:3000/sse/{server}
```

## 🧑‍💻 Local Development

```bash
git clone https://github.com/samanhappy/mcphub.git
cd mcphub
pnpm install
pnpm dev
```

This starts both frontend and backend in development mode with hot-reloading.

> For windows users, you may need to start the backend server and frontend separately: `pnpm backend:dev`, `pnpm frontend:dev`.

## 🛠️ Common Issues

### Using Nginx as a Reverse Proxy

If you are using Nginx to reverse proxy MCPHub, please make sure to add the following configuration in your Nginx setup:

```nginx
proxy_buffering off
```

## 🔍 Tech Stack

- **Backend**: Node.js, Express, TypeScript
- **Frontend**: React, Vite, Tailwind CSS
- **Auth**: JWT & bcrypt
- **Protocol**: Model Context Protocol SDK

## 👥 Contributing

Contributions of any kind are welcome!

- New features & optimizations
- Documentation improvements
- Bug reports & fixes
- Translations & suggestions

Welcome to join our [Discord community](https://discord.gg/qMKNsn5Q) for discussions and support.

## ❤️ Sponsor

If you like this project, maybe you can consider:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/samanhappy)

## 🌟 Star History

[![Star History Chart](https://api.star-history.com/svg?repos=samanhappy/mcphub&type=Date)](https://www.star-history.com/#samanhappy/mcphub&Date)

## 📄 License

Licensed under the [Apache 2.0 License](LICENSE).
