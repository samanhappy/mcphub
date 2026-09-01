# MCPHub — Agent Guide

MCPHub (`@samanhappy/mcphub`) is a TypeScript/Node.js ESM hub that aggregates MCP servers behind a single HTTP service with a React/Vite dashboard.

## Always apply

- Use `pnpm` (`pnpm@10.12.4`, declared in `package.json`).
- Treat the current implementation as the source of truth. If this guide disagrees with the code, follow the code and update the guide; tests document expected behavior and should change only when behavior intentionally changes.
- Do not hand-edit generated output: `dist/`, `frontend/dist/`, or `coverage/`.
- Read the scoped guide relevant to the files you will change. The full index is in [docs/agents/README.md](docs/agents/README.md).

## Project-specific build checks

- Backend typecheck/build: `pnpm backend:build`
- Full build: `pnpm build`
- Distribution verification: `node scripts/verify-dist.js`

## Scoped guides

- [Architecture and data/auth invariants](docs/agents/architecture.md)
- [Development workflow and troubleshooting](docs/agents/development.md)
- [TypeScript and frontend conventions](docs/agents/typescript-and-frontend.md)
- [Testing](docs/agents/testing.md)
- [API and CLI changes](docs/agents/api-and-cli.md)
- [Git and contribution workflow](docs/agents/git-and-contribution.md)
- [Agent-guide maintenance](docs/agents/guide-maintenance.md)
- [Domain documentation](docs/agents/domain.md)
- [GitHub issue tracker](docs/agents/issue-tracker.md)
- [Triage labels](docs/agents/triage-labels.md)
