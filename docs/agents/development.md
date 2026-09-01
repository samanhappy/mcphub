# Development workflow and troubleshooting

Use the commands defined in `package.json`; the following are the repository's canonical development and validation commands.

## Commands

| Purpose | Command |
| --- | --- |
| Install | `pnpm install` |
| Run backend and frontend | `pnpm dev` |
| Run backend only | `pnpm backend:dev` |
| Run frontend only | `pnpm frontend:dev` |
| Lint | `pnpm lint` |
| Format | `pnpm format` |
| CI-style tests | `pnpm test:ci` |
| Watch tests | `pnpm test:watch` |
| Build all | `pnpm build` |
| Verify distribution | `node scripts/verify-dist.js` |
| Start production build | `pnpm start` |

The backend listens on `:3000` unless `PORT` is set. The frontend dev server listens on `:5173` and proxies API and MCP requests to the backend.

## Validation by change

- For backend startup or MCP wiring changes, run `pnpm dev`, call `GET /health`, and inspect logs for successful upstream connections.
- For frontend changes, run `pnpm frontend:dev` and exercise the affected path in the browser; automated tests do not replace UX verification.
- MCP servers that require missing API keys may fail to connect locally; distinguish that expected environment failure from an MCPHub regression.
- The pre-commit validation gate is `pnpm lint && pnpm test:ci && pnpm build`. Fix failures instead of bypassing hooks with `--no-verify`.

## Troubleshooting

- If an MCP server fails to start, validate `mcp_settings.json` and confirm its `command` and `args` resolve on `PATH`.
- Python-based default servers may require `uvx` on `PATH`.
- If the frontend is missing in production, run `pnpm frontend:build` before starting the backend.
- Use `pnpm backend:build` for the full TypeScript error output.
- For a port conflict, change `PORT` or identify and stop the process holding the port.

The supported Node.js range is `^18.0.0 || >=20.0.0`; CI uses Node 20.x and the published Docker image uses Node 22.
