# MCPHub Development Guide & Agent Instructions

**ALWAYS follow these instructions first and only fallback to additional search and context gathering if the information here is incomplete or found to be in error.**

This document serves as the primary reference for all contributors and AI agents working on `@samanhappy/mcphub`. It provides comprehensive guidance on code organization, development workflow, and project conventions.

## Project Overview

MCPHub is a TypeScript/Node.js MCP (Model Context Protocol) server management hub that provides unified access through HTTP endpoints. It serves as a centralized dashboard for managing multiple MCP servers with real-time monitoring, authentication, and flexible routing.

**Core Components:**

- **Backend**: Express.js + TypeScript + ESM (`src/server.ts`)
- **Frontend**: React/Vite + Tailwind CSS (`frontend/`)
- **MCP Integration**: Connects multiple MCP servers (`src/services/mcpService.ts`)
- **Authentication**: JWT-based with bcrypt password hashing
- **Configuration**: JSON-based MCP server definitions (`mcp_settings.json`)
- **Documentation**: API docs and usage instructions(`docs/`)

## Bootstrap and Setup (CRITICAL - Follow Exact Steps)

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

## Project Structure & Module Organization

### Critical Backend Files

- `src/index.ts` - Application entry point
- `src/server.ts` - Express server setup and middleware (orchestrating HTTP bootstrap)
- `src/services/mcpService.ts` - **Core MCP server management logic**
- `src/config/index.ts` - Configuration management
- `src/routes/` - HTTP route definitions
- `src/controllers/` - HTTP request handlers
- `src/dao/` - Data access layer (supports JSON file & PostgreSQL)
- `src/db/` - TypeORM entities & repositories (for PostgreSQL mode)
- `src/types/index.ts` - TypeScript type definitions and shared DTOs
- `src/utils/` - Utility functions and helpers

### Critical Frontend Files

- `frontend/src/` - React application source (Vite + React dashboard)
- `frontend/src/pages/` - Page components (development entry point)
- `frontend/src/components/` - Reusable UI components
- `frontend/src/utils/fetchInterceptor.js` - Backend API interaction
- `frontend/public/` - Static assets

### Configuration Files

- `mcp_settings.json` - **MCP server definitions and user accounts**
- `package.json` - Dependencies and scripts
- `tsconfig.json` - TypeScript configuration
- `jest.config.cjs` - Test configuration
- `.eslintrc.json` - Linting rules

### Test Organization

- Jest-aware test code is split between colocated specs (`src/**/*.{test,spec}.ts`) and higher-level suites in `tests/`
- Use `tests/utils/` helpers when exercising the CLI or SSE flows
- Mirror production directory names when adding new suites
- End filenames with `.test.ts` or `.spec.ts` for automatic discovery

### Build Artifacts

- `dist/` - Backend build output (TypeScript compilation)
- `frontend/dist/` - Frontend build output (Vite bundle)
- `coverage/` - Test coverage reports
- **Never edit these manually**

### Localization

- Translations sit in `locales/` (en.json, fr.json, tr.json, zh.json)
- Frontend uses react-i18next

### Docker and Deployment

- `Dockerfile` - Multi-stage build with Python base + Node.js
- `entrypoint.sh` - Docker startup script
- `bin/cli.js` - NPM package CLI entry point

## Build, Test, and Development Commands

### Development Environment

```bash
# Start both backend and frontend (recommended for most development)
pnpm dev                    # Backend on :3001, Frontend on :5173

# OR start separately (required on Windows, optional on Linux/macOS)
# Terminal 1: Backend only
pnpm backend:dev            # Runs on port 3000 (or PORT env var)

# Terminal 2: Frontend only
pnpm frontend:dev           # Runs on port 5173, proxies API to backend

# Frontend preview (production build)
pnpm frontend:preview       # Preview production build
```

**NEVER CANCEL**: Development servers may take 10-15 seconds to fully initialize all MCP servers.

### Production Build

```bash
# Full production build - takes ~10 seconds total
pnpm build                  # NEVER CANCEL - Set timeout to 60+ seconds

# Individual builds
pnpm backend:build          # TypeScript compilation to dist/ - ~5 seconds
pnpm frontend:build         # Vite build to frontend/dist/ - ~5 seconds

# Start production server
pnpm start                  # Requires dist/ and frontend/dist/ to exist
```

Run `pnpm build` before release or publishing.

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

# Security audit
pnpm audit                  # Check for vulnerabilities
```

**CRITICAL**: All tests MUST pass before committing. Do not modify tests to make them pass unless specifically required for your changes.

### Performance Notes

- **Install time**: pnpm install takes ~30 seconds
- **Build time**: Full build takes ~10 seconds
- **Test time**: Complete test suite takes ~16 seconds
- **Startup time**: Backend initialization takes 10-15 seconds (MCP server connections)

## Coding Style & Naming Conventions

- **TypeScript everywhere**: Default to 2-space indentation and single quotes, letting Prettier settle formatting
- **ESM modules**: Always use `.js` extensions in imports, not `.ts` (e.g., `import { something } from './file.js'`)
- **English only**: All code comments must be written in English
- **TypeScript strict**: Follow strict type checking rules
- **Naming conventions**:
  - Services and data access layers: Use suffixes (`UserService`, `AuthDao`)
  - React components and files: `PascalCase`
  - Utility modules: `camelCase`
- **Types and DTOs**: Keep in `src/types` to avoid duplication; re-export through index files only when it clarifies imports
- **ESLint configuration**: Assumes ES modules

## Testing Guidelines

- Use Jest with the `ts-jest` ESM preset; place shared setup in `tests/setup.ts` and mock helpers under `tests/utils/`.
- Mirror production directory names when adding new suites and end filenames with `.test.ts` or `.spec.ts` for automatic discovery.
- Aim to maintain or raise coverage when touching critical flows (auth, OAuth, SSE); add integration tests under `tests/integration/` when touching cross-service logic.

## Key Configuration Notes

- **MCP servers**: Defined in `mcp_settings.json` with command/args
- **Endpoints**: `/mcp/{group|server}` and `/mcp/$smart` for routing
- **i18n**: Frontend uses react-i18next with files in `locales/` folder
- **Authentication**: JWT tokens with bcrypt password hashing
- **Default credentials**: admin/admin123 (configured in mcp_settings.json)

## Development Entry Points

### Adding a new MCP server

1. Add server definition to `mcp_settings.json`
2. Restart backend to load new server
3. Check logs for successful connection
4. Test via dashboard or API endpoints

### API development

1. Define route in `src/routes/`
2. Implement controller in `src/controllers/`
3. Add types in `src/types/index.ts` if needed
4. Write tests in `tests/controllers/`

### Frontend development

1. Create/modify components in `frontend/src/components/`
2. Add pages in `frontend/src/pages/`
3. Update routing if needed
4. Test in development mode with `pnpm frontend:dev`

### Documentation

1. Update or add docs in `docs/` folder
2. Ensure README.md reflects any major changes

## Commit & Pull Request Guidelines

- Follow the existing Conventional Commit pattern (`feat:`, `fix:`, `chore:`, etc.) with imperative, present-tense summaries and optional multi-line context.
- Each PR should describe the behavior change, list testing performed, and link issues; include before/after screenshots or GIFs for frontend tweaks.
- Re-run `pnpm build` and `pnpm test` before requesting review, and ensure generated artifacts stay out of the diff.

### Before Committing - ALWAYS Run

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

## DAO Layer & Dual Data Source

MCPHub supports **JSON file** (default) and **PostgreSQL** storage. Set `USE_DB=true` + `DB_URL` to switch.

### Key Files

- `src/types/index.ts` - Core interfaces (`IUser`, `IGroup`, `ServerConfig`, etc.)
- `src/dao/*Dao.ts` - DAO interface + JSON implementation
- `src/dao/*DaoDbImpl.ts` - Database implementation
- `src/db/entities/*.ts` - TypeORM entities
- `src/db/repositories/*.ts` - TypeORM repository wrappers
- `src/utils/migration.ts` - JSON-to-database migration

### Modifying Data Structures (CRITICAL)

When adding/changing fields, update **ALL** these files:

| Step | File                       | Action                       |
| ---- | -------------------------- | ---------------------------- |
| 1    | `src/types/index.ts`       | Add field to interface       |
| 2    | `src/dao/*Dao.ts`          | Update JSON impl if needed   |
| 3    | `src/db/entities/*.ts`     | Add TypeORM `@Column`        |
| 4    | `src/dao/*DaoDbImpl.ts`    | Map field in create/update   |
| 5    | `src/db/repositories/*.ts` | Update if needed             |
| 6    | `src/utils/migration.ts`   | Include in migration         |
| 7    | `mcp_settings.json`        | Update example if applicable |

### Data Type Mapping

| Model          | DAO               | DB Entity      | JSON Path                 |
| -------------- | ----------------- | -------------- | ------------------------- |
| `IUser`        | `UserDao`         | `User`         | `settings.users[]`        |
| `ServerConfig` | `ServerDao`       | `Server`       | `settings.mcpServers{}`   |
| `IGroup`       | `GroupDao`        | `Group`        | `settings.groups[]`       |
| `SystemConfig` | `SystemConfigDao` | `SystemConfig` | `settings.systemConfig`   |
| `UserConfig`   | `UserConfigDao`   | `UserConfig`   | `settings.userConfigs{}`  |
| `BearerKey`    | `BearerKeyDao`    | `BearerKey`    | `settings.bearerKeys[]`   |
| `IOAuthClient` | `OAuthClientDao`  | `OAuthClient`  | `settings.oauthClients[]` |
| `IOAuthToken`  | `OAuthTokenDao`   | `OAuthToken`   | `settings.oauthTokens[]`  |

### Common Pitfalls

- Forgetting migration script → fields won't migrate to DB
- Optional fields need `nullable: true` in entity
- Complex objects need `simple-json` column type

## Auto-Evolution Guidelines for AI Agents

**This section provides guidelines for AI agents to automatically maintain and improve this document.**

### When to Update AGENTS.md

AI agents MUST update this document in the following situations:

#### 1. Code-Documentation Mismatch Detected

When executing tasks, if you discover that:

- The actual code structure differs from descriptions in this document
- File paths, imports, or module organization has changed
- New critical files or directories exist that aren't documented
- Documented files or patterns no longer exist

**Action**: Immediately update the relevant section to reflect the current codebase state.

**Example scenarios**:

- A controller is now in `src/api/controllers/` instead of `src/controllers/`
- New middleware files exist that should be documented
- The DAO implementation has been refactored with a different structure
- Build output directories have changed

#### 2. User Preferences and Requirements

During conversation, if the user expresses:

- **Coding preferences**: Indentation style, naming conventions, code organization patterns
- **Workflow requirements**: Required validation steps, commit procedures, testing expectations
- **Tool preferences**: Preferred libraries, frameworks, or development tools
- **Quality standards**: Code review criteria, documentation requirements, error handling patterns
- **Development principles**: Architecture decisions, design patterns, best practices

**Action**: Add or update the relevant section to capture these preferences for future reference.

**Example scenarios**:

- User prefers async/await over promises → Update coding style section
- User requires specific test coverage thresholds → Update testing guidelines
- User has strong opinions about error handling → Add to development process section
- User establishes new deployment procedures → Update deployment section

### How to Update AGENTS.md

1. **Identify the Section**: Determine which section needs updating based on the type of change
2. **Make Precise Changes**: Update only the relevant content, maintaining the document structure
3. **Preserve Format**: Keep the existing markdown formatting and organization
4. **Add Context**: If adding new content, ensure it fits logically within existing sections
5. **Verify Accuracy**: After updating, ensure the new information is accurate and complete

### Update Principles

- **Accuracy First**: Documentation must reflect the actual current state
- **Clarity**: Use clear, concise language; avoid ambiguity
- **Completeness**: Include sufficient detail for agents to work effectively
- **Consistency**: Maintain consistent terminology and formatting throughout
- **Actionability**: Focus on concrete, actionable guidance rather than vague descriptions

### Self-Correction Process

Before completing any task:

1. Review relevant sections of AGENTS.md
2. During execution, note any discrepancies between documentation and reality
3. Update AGENTS.md to correct discrepancies
4. Verify the update doesn't conflict with other sections
5. Proceed with the original task using the updated information

### Meta-Update Rule

If this auto-evolution section itself needs improvement based on experience:

- Update it to better serve future agents
- Add new scenarios or principles as they emerge
- Refine the update process based on what works well

**Remember**: This document is a living guide. Keeping it accurate and current is as important as following it.
