# MCPHub Coding Instructions

**ALWAYS follow these instructions first and only fallback to additional search and context gathering if the information here is incomplete or found to be in error.**

## Project Overview

MCPHub is a TypeScript/Node.js MCP (Model Context Protocol) server management hub that provides unified access through HTTP endpoints. It serves as a centralized dashboard for managing multiple MCP servers with real-time monitoring, authentication, and flexible routing.

**Core Components:**

- **Backend**: Express.js + TypeScript + ESM (`src/server.ts`)
- **Frontend**: React/Vite + Tailwind CSS (`frontend/`)
- **MCP Integration**: Connects multiple MCP servers (`src/services/mcpService.ts`)
- **Authentication**: JWT-based with bcrypt password hashing
- **Configuration**: JSON-based MCP server definitions (`mcp_settings.json`)
- **Documentation**: API docs and usage instructions(`docs/`)

## Working Effectively

### Bootstrap and Setup (CRITICAL - Follow Exact Steps)

```bash
# Install pnpm if not available
npm install -g pnpm

# Install dependencies - takes ~30 seconds
pnpm install

# Setup environment (optional)
cp .env.example .env

# Build and test to verify setup
pnpm lint                    # ~3 seconds - NEVER CANCEL
pnpm backend:build          # ~5 seconds - NEVER CANCEL
pnpm test:ci                # ~16 seconds - NEVER CANCEL. Set timeout to 60+ seconds
pnpm frontend:build         # ~5 seconds - NEVER CANCEL
pnpm build                  # ~10 seconds total - NEVER CANCEL. Set timeout to 60+ seconds
```

**CRITICAL TIMING**: These commands are fast but NEVER CANCEL them. Always wait for completion.

### Development Environment

```bash
# Start both backend and frontend (recommended for most development)
pnpm dev                    # Backend on :3001, Frontend on :5173

# OR start separately (required on Windows, optional on Linux/macOS)
# Terminal 1: Backend only
pnpm backend:dev            # Runs on port 3000 (or PORT env var)

# Terminal 2: Frontend only
pnpm frontend:dev           # Runs on port 5173, proxies API to backend
```

**NEVER CANCEL**: Development servers may take 10-15 seconds to fully initialize all MCP servers.

### Build Commands (Production)

```bash
# Full production build - takes ~10 seconds total
pnpm build                  # NEVER CANCEL - Set timeout to 60+ seconds

# Individual builds
pnpm backend:build          # TypeScript compilation - ~5 seconds
pnpm frontend:build         # Vite build - ~5 seconds

# Start production server
pnpm start                  # Requires dist/ and frontend/dist/ to exist
```

### Testing and Validation

```bash
# Run all tests - takes ~16 seconds with 73 tests
pnpm test:ci                # NEVER CANCEL - Set timeout to 60+ seconds

# Development testing
pnpm test                   # Interactive mode
pnpm test:watch             # Watch mode for development
pnpm test:coverage          # With coverage report

# Code quality
pnpm lint                   # ESLint - ~3 seconds
pnpm format                 # Prettier formatting - ~3 seconds
```

**CRITICAL**: All tests MUST pass before committing. Do not modify tests to make them pass unless specifically required for your changes.

## Manual Validation Requirements

**ALWAYS perform these validation steps after making changes:**

### 1. Basic Application Functionality

```bash
# Start the application
pnpm dev

# Verify backend responds (in another terminal)
curl http://localhost:3000/api/health
# Expected: Should return health status

# Verify frontend serves
curl -I http://localhost:3000/
# Expected: HTTP 200 OK with HTML content
```

### 2. MCP Server Integration Test

```bash
# Check MCP servers are loading (look for log messages)
# Expected log output should include:
# - "Successfully connected client for server: [name]"
# - "Successfully listed [N] tools for server: [name]"
# - Some servers may fail due to missing API keys (normal in dev)
```

### 3. Build Verification

```bash
# Verify production build works
pnpm build
node scripts/verify-dist.js
# Expected: "✅ Verification passed! Frontend and backend dist files are present."
```

**NEVER skip these validation steps**. If any fail, debug and fix before proceeding.

## Project Structure and Key Files

### Critical Backend Files

- `src/index.ts` - Application entry point
- `src/server.ts` - Express server setup and middleware
- `src/services/mcpService.ts` - **Core MCP server management logic**
- `src/config/index.ts` - Configuration management
- `src/routes/` - HTTP route definitions
- `src/controllers/` - HTTP request handlers
- `src/dao/` - Data access layer for users, groups, servers
- `src/types/index.ts` - TypeScript type definitions

### Critical Frontend Files

- `frontend/src/` - React application source
- `frontend/src/pages/` - Page components (development entry point)
- `frontend/src/components/` - Reusable UI components
- `frontend/src/utils/fetchInterceptor.js` - Backend API interaction

### Configuration Files

- `mcp_settings.json` - **MCP server definitions and user accounts**
- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration
- `jest.config.cjs` - Test configuration
- `.eslintrc.json` - Linting rules

### Docker and Deployment

- `Dockerfile` - Multi-stage build with Python base + Node.js
- `entrypoint.sh` - Docker startup script
- `bin/cli.js` - NPM package CLI entry point

## Development Process and Conventions

### Code Style Requirements

- **ESM modules**: Always use `.js` extensions in imports, not `.ts`
- **English only**: All code comments must be written in English
- **TypeScript strict**: Follow strict type checking rules
- **Import style**: `import { something } from './file.js'` (note .js extension)

### Key Configuration Notes

- **MCP servers**: Defined in `mcp_settings.json` with command/args
- **Endpoints**: `/mcp/{group|server}` and `/mcp/$smart` for routing
- **i18n**: Frontend uses react-i18next with files in `locales/` folder
- **Authentication**: JWT tokens with bcrypt password hashing
- **Default credentials**: admin/admin123 (configured in mcp_settings.json)

### Development Entry Points

- **Add MCP server**: Modify `mcp_settings.json` and restart
- **New API endpoint**: Add route in `src/routes/`, controller in `src/controllers/`
- **Frontend feature**: Start from `frontend/src/pages/` or `frontend/src/components/`
- **Add tests**: Follow patterns in `tests/` directory

### Common Development Tasks

#### Adding a new MCP server:

1. Add server definition to `mcp_settings.json`
2. Restart backend to load new server
3. Check logs for successful connection
4. Test via dashboard or API endpoints

#### API development:

1. Define route in `src/routes/`
2. Implement controller in `src/controllers/`
3. Add types in `src/types/index.ts` if needed
4. Write tests in `tests/controllers/`

#### Frontend development:

1. Create/modify components in `frontend/src/components/`
2. Add pages in `frontend/src/pages/`
3. Update routing if needed
4. Test in development mode with `pnpm frontend:dev`

#### Documentation:

1. Update or add docs in `docs/` folder
2. Ensure README.md reflects any major changes

## Validation and CI Requirements

### Before Committing - ALWAYS Run:

```bash
pnpm lint                   # Must pass - ~3 seconds
pnpm backend:build          # Must compile - ~5 seconds
pnpm test:ci                # All tests must pass - ~16 seconds
pnpm build                  # Full build must work - ~10 seconds
```

**CRITICAL**: CI will fail if any of these commands fail. Fix issues locally first.

### CI Pipeline (.github/workflows/ci.yml)

- Runs on Node.js 20.x
- Tests: linting, type checking, unit tests with coverage
- **NEVER CANCEL**: CI builds may take 2-3 minutes total

## Troubleshooting

### Common Issues

- **"uvx command not found"**: Some MCP servers require `uvx` (Python package manager) - this is expected in development
- **Port already in use**: Change PORT environment variable or kill existing processes
- **Frontend not loading**: Ensure frontend was built with `pnpm frontend:build`
- **MCP server connection failed**: Check server command/args in `mcp_settings.json`

### Build Failures

- **TypeScript errors**: Run `pnpm backend:build` to see compilation errors
- **Test failures**: Run `pnpm test:verbose` for detailed test output
- **Lint errors**: Run `pnpm lint` and fix reported issues

### Development Issues

- **Backend not starting**: Check for port conflicts, verify `mcp_settings.json` syntax
- **Frontend proxy errors**: Ensure backend is running before starting frontend
- **Hot reload not working**: Restart development server

## Performance Notes

- **Install time**: pnpm install takes ~30 seconds
- **Build time**: Full build takes ~10 seconds
- **Test time**: Complete test suite takes ~16 seconds
- **Startup time**: Backend initialization takes 10-15 seconds (MCP server connections)

**Remember**: NEVER CANCEL any build or test commands. Always wait for completion even if they seem slow.
