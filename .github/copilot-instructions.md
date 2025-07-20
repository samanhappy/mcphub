# MCPHub Coding Instructions

## Project Overview

MCPHub is a TypeScript/Node.js MCP server management hub that provides unified access through HTTP endpoints.

**Core Components:**

- **Backend**: Express.js + TypeScript + ESM (`src/server.ts`)
- **Frontend**: React/Vite + Tailwind CSS (`frontend/`)
- **MCP Integration**: Connects multiple MCP servers (`src/services/mcpService.ts`)

## Development Environment

```bash
pnpm install
pnpm dev           # Start both backend and frontend
pnpm backend:dev   # Backend only
pnpm frontend:dev  # Frontend only
```

## Project Conventions

### File Structure

- `src/services/` - Core business logic
- `src/controllers/` - HTTP request handlers
- `src/types/index.ts` - TypeScript type definitions
- `src/config/index.ts` - Configuration management

### Key Notes

- Use ESM modules: Import with `.js` extensions, not `.ts`
- Configuration file: `mcp_settings.json`
- Endpoint formats: `/mcp/{group|server}` and `/mcp/$smart`
- All code comments must be written in English
- Frontend uses i18n with resource files in `locales/` folder
- Server-side code should use appropriate abstraction layers for extensibility and replaceability

## Development Process

- For complex features, implement step by step and wait for confirmation before proceeding to the next step
- After implementing features, no separate summary documentation is needed - update README.md and README.zh.md as appropriate

### Development Entry Points

- **MCP Servers**: Modify `src/services/mcpService.ts`
- **API Endpoints**: Add routes in `src/routes/`, controllers in `src/controllers/`
- **Frontend Features**: Start from `frontend/src/pages/`
- **Testing**: Follow existing patterns in `tests/`
