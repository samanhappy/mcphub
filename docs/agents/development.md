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
| Validate docs | `pnpm docs:validate` |
| Start production build | `pnpm start` |

The backend listens on `:3000` unless `PORT` is set. The frontend dev server listens on `:5173` and proxies API and MCP requests to the backend.

## Validation by change

- For backend startup or MCP wiring changes, run `pnpm dev`, call `GET /health`, and inspect logs for successful upstream connections.
- For frontend changes, run `pnpm frontend:dev` and exercise the affected path in the browser; automated tests do not replace UX verification.
- For changes under `docs/`, run `pnpm docs:validate`. The Mintlify check parses only the paths a commit touches, so a page broken by an earlier commit stays invisible until that page is edited again; this compiles every page and reports the same `file:line:column`.
- MCP servers that require missing API keys may fail to connect locally; distinguish that expected environment failure from an MCPHub regression.
- The pre-commit validation gate is `pnpm lint && pnpm test:ci && pnpm build`. Fix failures instead of bypassing hooks with `--no-verify`.

## Troubleshooting

- If an MCP server fails to start, validate `mcp_settings.json` and confirm its `command` and `args` resolve on `PATH`.
- Python-based default servers may require `uvx` on `PATH`.
- If the frontend is missing in production, run `pnpm frontend:build` before starting the backend.
- Use `pnpm backend:build` for the full TypeScript error output.
- For a port conflict, change `PORT` or identify and stop the process holding the port.

## Agent shell `PATH`

Agent bash shells run non-interactively with a minimal `PATH` and do not load
the user's shell profile, so bare `gh`, `pnpm`, `node`, or `npx` can report
`command not found` **even when the user has them installed** — this is not an
install problem and varies by machine. First confirm what resolves and where
the rest lives:

```bash
command -v gh pnpm node git curl
ls ~/.nvm/versions/node/*/bin 2>/dev/null   # nvm-managed Node toolchain
ls /opt/homebrew/bin 2>/dev/null            # Homebrew (Apple Silicon)
ls /usr/local/bin 2>/dev/null               # Homebrew (Intel macOS) / other prefixes
```

Export the directories that hold the toolchain, then rerun the failed command.
On this repo's primary development machine that is:

```bash
export PATH="/opt/homebrew/bin:$HOME/.nvm/versions/node/v24.15.0/bin:$PATH"
gh issue view 643
pnpm backend:build
```

If the exports still do not resolve the tools, ask the user for the install
location instead of guessing.

## Agent shell file sandbox

Agent bash shells also run under a file sandbox that denies writes outside the
repo workspace (default policy: workspace-write). Commands that succeed in the
user's own terminal can fail here purely because of the sandbox:

- `npx -y <pkg>` fails with `EPERM` on `~/.npm/_cacache/tmp/***`. npm's
  "Your cache folder contains root-owned files" message is misleading — the
  files are user-owned; `touch ~/.npm/_cacache/tmp/x` returning
  `Operation not permitted` is the sandbox denying the write.
- Any other tool that writes a cache under the user's home (`uvx`, pip, …)
  is subject to the same restriction.

This breaks `pnpm test` runs when a suite spawns a real MCP server via `npx`:
`tests/integration/sse-service-real-client.test.ts` uses `npx -y time-mcp`
(see `tests/utils/mockSettings.ts`), so the upstream never starts and the
suite's `beforeAll` hooks time out (60s), even though the identical run
passes in the user's terminal.

Workarounds, in order of preference:

1. Redirect the tool's cache into the workspace, e.g.
   `NPM_CONFIG_CACHE=<workspace>/.npm-cache-test pnpm test <suite>`;
   delete the cache directory afterwards.
2. Request a wider sandbox permission for the run.

The supported Node.js range is `^18.0.0 || >=20.0.0`; CI uses Node 20.x and the published Docker image uses Node 22.
