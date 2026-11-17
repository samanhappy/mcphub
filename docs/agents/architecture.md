# Architecture and data/auth invariants

Read this guide when changing runtime wiring, MCP connections, HTTP routing, authentication, persistence, or database behavior. For the public runtime overview, see [docs/development/architecture.mdx](../development/architecture.mdx).

## Runtime map

- `src/index.ts` starts the process and `src/server.ts` owns `AppServer` initialization, route registration, and shutdown.
- `src/services/mcpService.ts` wires upstream clients and MCP request handlers. `mcpConnectionLifecycle.ts` manages runtime shutdown and on-demand wake/idle transitions; `mcpStdioLifecycle.ts` owns process-tree termination and draining. `mcpTools.ts`, `mcpPrompts.ts`, and `mcpResources.ts` handle tool, prompt, and resource requests. Authorization wrappers stay in `mcpService.ts`; `mcpRequestScope.ts` bounds request-local server projections.
- `src/routes/` defines HTTP routes; `src/controllers/` implements resource handlers.
- `src/dao/` provides file-backed persistence by default; `src/db/` provides the optional TypeORM/PostgreSQL backend.
- `src/clients/` contains upstream MCP client wrappers.
- `src/types/` contains shared configuration and domain types.
- `frontend/src/` contains the Vite/React dashboard.

## Persistence changes

When adding or changing a persisted field, update every applicable layer:

1. `src/types/index.ts` — shared interface or schema.
2. `src/dao/*Dao.ts` — JSON implementation when behavior changes.
3. `src/db/entities/*.ts` — TypeORM column; mark optional fields `nullable` and use `simple-json` for object values.
4. `src/dao/*DaoDbImpl.ts` — database create/update mapping.
5. `src/db/repositories/*.ts` — repository wrapper, when it exposes the field.
6. `src/utils/migration.ts` — JSON-to-database migration.
7. `mcp_settings.json` — example configuration, when user-facing.

Database mode is selected at startup by the code in `src/dao/DaoFactory.ts`: `USE_DB=true` enables it; when `USE_DB` is unset, a configured `DB_URL` enables it; an explicit `USE_DB=false` disables it.

Multi-replica mode is explicit (`MCPHUB_REPLICA_MODE=true`). Run `pnpm db:setup` once before serving with `DB_SYNCHRONIZE=false`; `src/db/replicaSchema.ts` tracks configuration writes transactionally, and `src/services/replicaService.ts` reconciles them every five seconds. Configuration API handlers use a request-scoped database transaction; preserve that scope when adding DAO access. Sessions and application workflow state remain local. See [replica deployment](../configuration/replicas.mdx) for the supported boundaries and `pnpm test:replicas` for disposable Docker verification.

Personal credential import is independent of user seeding. Validate source and destination ciphertext with the existing runtime key before importing, and commit bindings with their internal `credential_binding_imports` receipts in one transaction. Receipts must survive binding deletion to prevent retained source files from restoring revoked credentials; keep them out of configuration exports.

## File staging

Optional staged-file handoff for stdio servers (#1056). Modules live in `src/services/fileStaging/`: `adapter.ts` (pinned SSH profile, resolved-argv allowlist, per-principal cwd), `identity.ts` (owner hash), `rewrite.ts` (`mcpfile://` planning), `policy.ts` (shared lease/finalize decisions), `dispatch.ts` (the seam), `settings.ts` (master switch and store selection), `stateStore.ts` / `dbStateStore.ts` (ledgers), `tools.ts` (hub tools), `paths.ts` (layout and symlink-safe IO), `processLock.ts`. Configuration validation is in `src/utils/fileStagingConfig.ts`, the download handler is `src/controllers/fileStagingController.ts`, the staging PATCH routes are in `src/routes/serverRoutes.ts`, and virtual-tool injection plus dispatch are in `src/services/mcpService.ts`.

`dispatchStagedToolCall()` is the single rewrite/lease/finalize seam, called from `callToolWithReconnect` so direct calls and `$smart call_tool` share it. Hidden-argument removal happens inside the wrapped per-call path, so a parameter declared for staging must also be rejected from `hiddenParams` at config validation. The order is security-relevant: re-read the config, validate the adapter/stable server id/pinned version, plan exact references, pin inputs and lease every output, rewrite only declared parameters, invoke, then finalize or fail the outputs. Pins are released in `finally`; do not add a second rewrite path.

There are two ledger backends selected once in `settings.ts`: file mode (`FileStagingStateStore`, `data/staging-state/refs.json` plus a lock) and database mode (`DbStagingStateStore`, `file_staging_refs` / `file_staging_tokens`). Both implement `StagingStateStore` and share the decisions in `policy.ts`; keep lease/finalize rules there rather than duplicating them. With `DB_SYNCHRONIZE=false`, the schema comes from `docs/migrations/0006-file-staging.sql`.

`processLock.ts` enforces one writer per state directory through `staging.lock` (30-second mtime heartbeat, takeover only after 120 seconds stale); initialization runs at startup when the master switch is on (otherwise on first use) and releases the lock when init fails. `resolveStagingCwd()` moves the child cwd to the principal root for any server with a staged tool, so a `fileStaging` toggle must remain connection-relevant in `src/utils/connectionRelevantConfig.ts`. The `mcphub_file_` prefix is reserved: the hub definition wins over an upstream tool and must never fall through to upstream dispatch. Download links are minted only from a configured non-localhost base URL (`src/utils/installBaseUrl.ts`).

## Bearer-key invariant

Bearer keys have explicit kinds. Legacy and operator-created keys use `kind: 'system'`; user-level keys use `kind: 'user'` and must have an `owner`. Do not infer the kind from whether `owner` is empty. Personal keys support `all` or `groups` scope; allowed-group scope must intersect with the owner's permissions and must not allow global or direct-server routes. User-level keys restore the owner's live user context on MCP transport requests and are not dashboard API credentials.

## Routing surface

- `/mcp/{group|server}` routes to a group, server, or `$smart`. `SMART_ROUTING_PATH` adds a reserved alias for `$smart`; transport middleware normalizes the alias before authentication while preserving the original OAuth resource URL.
- `/:user/mcp/{group|server}` and `/:user/sse/{group}` are user-scoped variants.
- `AppServer.initialize()` in `src/server.ts` is the route-registration entry point.
- Authentication spans dashboard JWT/bcrypt, passkeys, bearer keys, MCPHub's OAuth authorization server, and optional Better Auth. Inspect the current middleware and route code before changing auth behavior.
- Passkeys (`src/services/passkeyService.ts`) are a local-account credential: they follow `disablePasswordLogin`, are stored like OAuth approvals (`PasskeyDao` sidecar file or `user_passkeys`), and their two public sign-in routes are listed in `isApiAuthExemptPath`. Each passkey keeps the RP ID it was created under and is accepted only there, and is bound to the owner's session version like OAuth approvals, so a password change or account recreation revokes it. Sign-in usage is written update-only (`recordUse`) with the counter check in the same write (`isCounterAdvance`; a conditional `UPDATE` in database mode), so a removed passkey is never recreated and a racing sign-in cannot move the counter backwards; replica mode records spent challenges in `oauth_state`.

## Declarative database configuration

`MCPHUB_SETTINGS_SYNC=upsert|prune` reconciles server/group declarations at startup only; see `src/utils/settingsSync.ts`. Keep runtime authentication state outside reconciliation. Internal sync ownership markers and the server declaration fingerprint must stay out of public DAO mappings and settings exports; unchanged declarations retain upstream OAuth state, while changes invalidate it. Pruning deletes only managed entries in explicitly supplied collections, with associated cleanup in the same transaction.
