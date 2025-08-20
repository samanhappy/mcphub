# MCPHub Project Overview

## Project Summary

MCPHub is a centralized hub server for managing multiple Model Context Protocol (MCP) servers. It allows organizing these servers into flexible Streamable HTTP (SSE) endpoints, supporting access to all servers, individual servers, or logical server groups. It provides a web dashboard for monitoring and managing servers, along with features like authentication, group-based access control, and Smart Routing using vector semantic search.

## Technology Stack

### Backend
- **Language:** TypeScript (Node.js)
- **Framework:** Express
- **Key Libraries:**
  - `@modelcontextprotocol/sdk`: Core library for MCP interactions.
  - `typeorm`: ORM for database interactions.
  - `pg` & `pgvector`: PostgreSQL database and vector support.
  - `jsonwebtoken` & `bcryptjs`: Authentication (JWT) and password hashing.
  - `openai`: For embedding generation in Smart Routing.
  - Various utility and validation libraries (e.g., `dotenv`, `express-validator`, `uuid`).

### Frontend
- **Framework:** React (via Vite)
- **Language:** TypeScript
- **UI Library:** Tailwind CSS
- **Routing:** `react-router-dom`
- **Internationalization:** `i18next`
- **Component Structure:** Modular components and pages within `frontend/src`.

### Infrastructure
- **Build Tool:** `pnpm` (package manager and script runner).
- **Containerization:** Docker (`Dockerfile` provided).
- **Process Management:** Not explicitly defined in core files, but likely managed by Docker or host system.

## Key Features

- **MCP Server Management:** Configure, start, stop, and monitor multiple upstream MCP servers via `stdio`, `SSE`, or `Streamable HTTP` protocols.
- **Centralized Dashboard:** Web UI for server status, group management, user administration, and logs.
- **Flexible Endpoints:**
  - Global MCP/SSE endpoint (`/mcp`, `/sse`) for all enabled servers.
  - Group-based endpoints (`/mcp/{group}`, `/sse/{group}`).
  - Server-specific endpoints (`/mcp/{server}`, `/sse/{server}`).
  - Smart Routing endpoint (`/mcp/$smart`, `/sse/$smart`) using vector search.
- **Authentication & Authorization:** JWT-based user authentication with role-based access control (admin/user).
- **Group Management:** Logical grouping of servers for targeted access and permission control.
- **Smart Routing (Experimental):** Uses pgvector and OpenAI embeddings to semantically search and find relevant tools across all connected servers.
- **Configuration:** Managed via `mcp_settings.json`.
- **Logging:** Server logs are captured and viewable via the dashboard.
- **Marketplace Integration:** Access to a marketplace of MCP servers (`servers.json`).

## Project Structure

```
C:\code\mcphub\
├───src\                  # Backend source code (TypeScript)
├───frontend\             # Frontend source code (React/TypeScript)
│   ├───src\
│       ├───components\   # Reusable UI components
│       ├───pages\        # Top-level page components
│       ├───contexts\     # React contexts (Auth, Theme, Toast)
│       ├───layouts\      # Page layouts
│       ├───utils\        # Frontend utilities
│       └───...
├───dist\                 # Compiled backend output
├───frontend\dist\        # Compiled frontend output
├───tests\                # Backend tests
├───docs\                 # Documentation
├───scripts\              # Utility scripts
├───bin\                  # CLI entry points
├───assets\               # Static assets (e.g., images for README)
├───.github\              # GitHub workflows
├───.vscode\              # VS Code settings
├───mcp_settings.json     # Main configuration file for MCP servers and users
├───servers.json          # Marketplace server definitions
├───package.json          # Node.js project definition, dependencies, and scripts
├───pnpm-lock.yaml        # Dependency lock file
├───tsconfig.json         # TypeScript compiler configuration (Backend)
├───README.md             # Project documentation
├───Dockerfile            # Docker image definition
└───...
```

## Building and Running

### Prerequisites
- Node.js (>=18.0.0 or >=20.0.0)
- pnpm
- Python 3.13 (for some upstream servers and uvx)
- Docker (optional, for containerized deployment)
- PostgreSQL with pgvector (optional, for Smart Routing)

### Local Development
1.  Clone the repository.
2.  Install dependencies: `pnpm install`.
3.  Start development servers: `pnpm dev`.
    - This runs `pnpm backend:dev` (Node.js with `tsx watch`) and `pnpm frontend:dev` (Vite dev server) concurrently.
    - Access the dashboard at `http://localhost:5173` (Vite default) or the configured port/path.

### Production Build
1.  Install dependencies: `pnpm install`.
2.  Build the project: `pnpm build`.
    - This runs `pnpm backend:build` (TypeScript compilation to `dist/`) and `pnpm frontend:build` (Vite build to `frontend/dist/`).
3.  Start the production server: `pnpm start`.
    - This runs `node dist/index.js`.

### Docker Deployment
- Pull the image: `docker pull samanhappy/mcphub`.
- Run with default settings: `docker run -p 3000:3000 samanhappy/mcphub`.
- Run with custom config: `docker run -p 3000:3000 -v ./mcp_settings.json:/app/mcp_settings.json -v ./data:/app/data samanhappy/mcphub`.
- Access the dashboard at `http://localhost:3000`.

## Configuration

The main configuration file is `mcp_settings.json`. It defines:
- `mcpServers`: A map of server configurations (command, args, env, URL, etc.).
- `users`: A list of user accounts (username, hashed password, admin status).
- `groups`: A map of server groups.
- `systemConfig`: System-wide settings (e.g., proxy, registry, installation options).

## Development Conventions

- **Language:** TypeScript for both backend and frontend.
- **Backend Style:** Modular structure with clear separation of concerns (controllers, services, models, middlewares, routes, config, utils).
- **Frontend Style:** Component-based React architecture with contexts for state management.
- **Database:** TypeORM with PostgreSQL is used, leveraging decorators for entity definition.
- **Testing:** Uses `jest` for backend testing.
- **Linting/Formatting:** Uses `eslint` and `prettier`.
- **Scripts:** Defined in `package.json` under the `scripts` section for common tasks (dev, build, start, test, lint, format).
