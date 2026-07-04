# MCPHub — Agent Guide

Authoritative instructions for AI agents and contributors working in this repo. Trust this file first; only fall back to wider search when something here is missing or contradicts the code. When you discover a contradiction, **fix the code or fix this file** — never let them drift.

This guide is intentionally short. It points to where the details live rather than restating them. Read the linked file when you need depth.

---

## 1. What this repo is

`@samanhappy/mcphub` is a TypeScript/Node (ESM) hub that aggregates multiple MCP (Model Context Protocol) servers behind a single HTTP surface, with a React/Vite dashboard.

| Layer    | Entry                                   | Notes                                        |
| -------- | --------------------------------------- | -------------------------------------------- |
| Backend  | [src/index.ts](src/index.ts) → [src/server.ts](src/server.ts) | Express + TypeORM (optional) + MCP SDK       |
| Frontend | [frontend/src/](frontend/src/)          | Vite + React + Tailwind, i18n via react-i18next |
| Config   | [mcp_settings.json](mcp_settings.json)  | MCP server defs, users, groups, OAuth state  |
| Docs     | [docs/](docs/)                          | Public docs (Mintlify). See [docs/development/](docs/development/) for architecture |

Layout map (read the directory when you need specifics, don't expand it here):

- `src/{routes,controllers,services,dao,db,middlewares,models,utils,types,config,clients}/`
- `src/services/mcpService.ts` — **core** MCP connection/lifecycle logic
- `src/dao/` + `src/db/` — dual datasource (JSON file by default, PostgreSQL when `USE_DB=true`)
- `tests/` mirrors `src/`; colocated `*.test.ts` also picked up
- `locales/{en,fr,tr,zh}.json` — i18n strings
- `dist/`, `frontend/dist/`, `coverage/` — generated; never hand-edit

---

## 2. Workflow contract

### Commands (canonical list — don't duplicate elsewhere)

| Purpose          | Command               |
| ---------------- | --------------------- |
| Install          | `pnpm install`        |
| Dev (both)       | `pnpm dev`            |
| Dev backend only | `pnpm backend:dev`    |
| Dev frontend     | `pnpm frontend:dev`   |
| Lint             | `pnpm lint`           |
| Format           | `pnpm format`         |
| Test (CI mode)   | `pnpm test:ci`        |
| Test (watch)     | `pnpm test:watch`     |
| Build all        | `pnpm build`          |
| Verify dist      | `node scripts/verify-dist.js` |
| Start prod       | `pnpm start`          |

Backend listens on `:3000` (or `$PORT`). Frontend dev server `:5173` proxies API calls to the backend.

### Pre-commit gate (must all pass)

```bash
pnpm lint && pnpm test:ci && pnpm build
```

The runtime requirement is `^18.0.0 || >=20.0.0` (see `package.json`); CI runs on Node 20.x, and the published Docker image is built on Node 22 (see `Dockerfile`). If a hook fails, fix the root cause — do **not** bypass with `--no-verify`.

### Post-change manual checks (when relevant)

- Touched backend startup / MCP wiring → `pnpm dev`, hit `GET /health`, scan logs for `Successfully connected client for server: …`.
- Touched frontend UI → open the page in `pnpm frontend:dev` and exercise the path; tests don't catch UX regressions.
- Some MCP servers fail to connect without API keys — that is expected locally and not a regression signal.

---

## 3. Conventions (hard rules)

- **ESM imports**: always use `.js` extensions for relative imports (e.g. `import { x } from './foo.js'`). TS files included.
- **TypeScript strict** is on; do not weaken it. Don't paper over types with `any` — narrow or define a type.
- **Comments in English only.**
- **Formatting**: 2-space indent, single quotes — let Prettier decide (`pnpm format`). ESLint config is the flat [eslint.config.mjs](eslint.config.mjs).
- **Naming**:
  - Services / DAOs: `XxxService`, `XxxDao` (suffix-based).
  - React components & their files: `PascalCase`.
  - Utility modules: `camelCase`.
- **Shared types live in [src/types/](src/types/)**. Don't redefine DTOs locally.
- **Conventional Commits** (`feat:`, `fix:`, `chore:`, `refactor:`, …), imperative present tense.
- **PRs**: describe behavior change, list manual + automated tests, attach before/after for UI work, link issues. Keep generated artifacts out of the diff.

---

## 4. Architecture invariants

### Dual datasource (JSON ⇄ PostgreSQL)

`USE_DB=true` + `DB_URL` switches storage from `mcp_settings.json` to Postgres via TypeORM.

**When adding/changing a persisted field, update every layer or migrations will silently drop it:**

| # | File                       | What to do                          |
| - | -------------------------- | ----------------------------------- |
| 1 | `src/types/index.ts`       | Add/modify the interface            |
| 2 | `src/dao/*Dao.ts`          | JSON impl (if behavior changes)     |
| 3 | `src/db/entities/*.ts`     | TypeORM `@Column` (mark `nullable`, use `simple-json` for objects) |
| 4 | `src/dao/*DaoDbImpl.ts`    | Map field in create/update          |
| 5 | `src/db/repositories/*.ts` | Update if the wrapper exposes it    |
| 6 | `src/utils/migration.ts`   | Include in JSON→DB migration        |
| 7 | `mcp_settings.json`        | Update the example if user-facing   |

Model ↔ DAO ↔ entity ↔ JSON-path mapping: inspect the DAO files in [src/dao/](src/dao/) directly — they are the source of truth, and any table reproduced here would drift.

Common pitfalls: forgetting step 6 → silent migration drop; missing `nullable: true` → DB write fails; complex object stored without `simple-json` → serialization error.

Bearer keys have two explicit kinds: legacy and operator-created keys are `kind: 'system'`; user-level keys are `kind: 'user'` and must have an `owner`. Do not infer kind from whether `owner` is empty. User-level keys restore the owner's live user context on MCP transport requests and are never dashboard API credentials.

### Routing surface

- `/mcp/{group|server}` — route to a specific group or single server.
- `/mcp/$smart` — smart routing.
- `/:user/mcp/{group|server}`, `/:user/sse/{group}` — user-scoped variants; the `:user` prefix selects which owner's servers/groups are visible. See `AppServer.initialize()` in [src/server.ts](src/server.ts).
- Auth: JWT (HS256) + bcrypt for the dashboard, layered with bearer keys (`/api/auth/keys`), MCPHub's own OAuth authorization server (`@node-oauth/oauth2-server`), and optional Better Auth (GitHub/Google). Default admin password is randomized unless `ADMIN_PASSWORD` is set on first launch.

For deeper architecture context, read [docs/development/architecture.mdx](docs/development/architecture.mdx).

---

## 5. Testing

- Jest with `ts-jest` ESM preset. Shared setup in [tests/setup.ts](tests/setup.ts), helpers in [tests/utils/](tests/utils/).
- Place suites under `tests/<area>/` mirroring `src/`, **or** colocate as `src/**/*.test.ts`. Both are picked up.
- Name files `*.test.ts` / `*.spec.ts`.
- Touching auth, OAuth, or SSE flows? Add or extend an integration test under [tests/integration/](tests/integration/). Don't lower coverage on these paths.
- Do **not** modify tests to make them pass unless the behavior change is the point of the PR.

---

## 6. Common entry points

| Task                  | Where to start                                                        |
| --------------------- | --------------------------------------------------------------------- |
| Add an MCP server     | Edit `mcp_settings.json`, restart backend, check connect log line     |
| Add an HTTP API       | `src/routes/` → `src/controllers/` → types in `src/types/` → tests   |
| Add a frontend page   | `frontend/src/pages/` (+ `frontend/src/components/`), wire in router |
| Add a CLI subcommand  | `src/cli/commands/<name>.ts` + register in `src/cli/main.ts` dispatcher + `src/cli/help.ts` + tests in `tests/cli/commands/` |
| Add a translation key | Add to all four `locales/*.json` files                                |
| Update public docs    | `docs/` (Mintlify); reflect major changes in all README variants (`README*.md`) |

---

## 7. Troubleshooting (quick pointers)

- **MCP server fails to start**: validate JSON in `mcp_settings.json`; check the `command`/`args` resolves on PATH (e.g. `uvx` is required for Python-based servers that use it, such as the default `fetch` server).
- **Frontend not served**: production mode needs `pnpm frontend:build` first.
- **Type errors**: `pnpm backend:build` shows the full TS output.
- **Port conflict**: change `PORT` or kill the holder.

### GitHub security advisories / code scanning (private)

```bash
gh auth status
gh api repos/samanhappy/mcphub/security-advisories/<ghsa_id>
gh api repos/samanhappy/mcphub/code-scanning/alerts/<alert_number>
gh api repos/samanhappy/mcphub/code-scanning/alerts/<alert_number>/instances
```

Compare advisory details against current `main` and the tagged fix commit before deciding if the issue is still live.
For CodeQL/code-scanning alerts, prefer the API calls above over opening `github.com/.../security/code-scanning/...` directly — the web page may 404 or hide details without the right GitHub session, while `alerts/<id>` returns the rule, severity, `most_recent_instance`, and message, and `/instances` confirms the concrete locations.

---

## 8. Agent self-maintenance

This file is a living contract. Keep it accurate; resist the urge to grow it.

**Update when:**

- A path, command, or invariant referenced here no longer matches the code.
- The user states a durable preference (style, workflow, tool choice) that future agents need to honor.
- A new architectural invariant emerges (something that, if violated, will silently break things) — like the dual-datasource checklist above.

**Don't add:**

- Step-by-step build logs, command timings, or "NEVER CANCEL" warnings — agents read the docs, not the stopwatch.
- Anything trivially discoverable by `ls`, `grep`, or reading the file the section already points to.
- Per-task narratives or recent-change summaries — those belong in commits and PRs.

**How to edit:**

1. Find the smallest section that owns the fact. Edit in place.
2. Prefer a pointer (`see X`) over copying details. One source of truth per fact.
3. If a section grows past a screen, it's probably duplicating something downstream — push detail into the relevant subdirectory's README/AGENTS.md instead.
4. After editing, skim the rest for stale references to what you changed.

**Scoped guides:** when a subsystem accumulates rules that don't generalize (e.g. frontend-only conventions), prefer a nested `frontend/AGENTS.md` over bloating this file. Agents read the nearest AGENTS.md to the files they're editing.

---

## Agent skills

### Issue tracker

GitHub Issues for `samanhappy/mcphub`, accessed via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` at repo root + `docs/adr/` for architectural decision records. See `docs/agents/domain.md`.
