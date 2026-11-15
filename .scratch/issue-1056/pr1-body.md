## Summary

First implementation slice of the file staging design agreed in #1056 (ADR in #1471). A stdio server behind the hub can now be configured so that a tool parameter accepts an uploaded file, or reserves a path for a tool-written output, without exposing the client filesystem or the hub's own files.

```text
handleCallToolRequest
  isReservedStagingName? ── yes ──> handleHubStagingCall   # before replica/policy/principal wrappers
  no
  withReplicaServerScope → withToolPolicy → withPrincipalServers
    handleCallToolRequestImpl
      callToolWithReconnect
        dispatchStagedToolCall            # the single staging seam
          resolveStagedCall               # re-read config, validate trust + pinned version
          pin inputs / lease outputs      # before the child runs
          planRewrite + applyRewrite      # declared params only
          invoke upstream
          finalize outputs (or fail them)
```

Config shape:

```jsonc
"staging": { "shared": true, "adapter": "ssh" },     // admin-only trust declaration
"tools": {
  "upload":   { "enabled": true, "fileStaging": { "enabled": true, "inputParams": ["localPath"] } },
  "download": { "enabled": true, "fileStaging": { "enabled": true, "outputParams": ["localPath"] } }
}
```

What is in this PR:

- **Config/persistence**: `staging` (server trust) and per-tool `fileStaging` in types, JSON/DB DAOs, settings sync, JSON→DB migration, template export (trust is stripped), dashboard tool metadata, and connection-relevant change detection. `null` simple-json columns are treated as absent.
- **Ledger**: one authoritative ledger per hub, file mode (`data/staging-state`, process lock, startup sweep) and DB mode (`file_staging_refs` / `file_staging_tokens`). Exclusive all-or-none output leases acquired before the upstream call, no runtime lease TTL, startup turns leased `reserved` rows terminal, read pins, quota reserved at lease, one-time download tokens, file-count cap, disk-space guard, owner scoping, stable per-principal identity (user UUID, never username), and server binding of refs.
- **SSH trust profile**: `@fangjunjie/ssh-mcp-server@1.11.0` pinned in args, resolved-argv allowlist that rejects `--allowed-local-paths`/`--config-file`, shared servers require per-user credential slots, and per-principal child `cwd` (owner-only included; no hub-cwd fallback). Shared servers' credential-less global placeholder gets a reserved directory.
- **Virtual tools**: `mcphub_file_upload`, `mcphub_file_status`, `mcphub_file_download`, injected per route only when a staging target is visible, hub namespace wins over an upstream tool of the same name.
- **Download endpoint**: `GET /api/staging/download/:token`, single-use token, `attachment` + `nosniff`, 404 for missing/used/expired.
- **Tests**: 326 tests across the touched suites, including the deterministic two-concurrent-calls lease test required in review.

Not in this PR (per the agreed staging): browser upload UI (PR2), `$smart` virtual tools (PR3), `request_upload`/elicitation, response-path detection, S3/multi-node, OS-level isolation, MCP Apps file API.

## Evidence

- `pnpm backend:build` — pass.
- `eslint` on every touched file — pass.
- `jest` on `src/services/fileStaging` + config/DAO/controller suites — 326 passed.
- Real SSH path-boundary run, pinned `@fangjunjie/ssh-mcp-server@1.11.0` against a real sshd, child `cwd` = per-principal root:

```text
✓ upload outside the per-principal root is denied        LOCAL_PATH_NOT_ALLOWED
✓ upload of the hub ledger is denied                     LOCAL_PATH_NOT_ALLOWED
✓ upload inside the per-principal root succeeds          File uploaded successfully
✓ download to a path outside the root is denied          file unchanged
✓ denied uploads left no remote file; allowed one arrived
```

The harness is committed as `scripts/verify-staging-ssh-boundary.mjs` (env-configured, no credentials in the repo).

## Merge Danger

**Door:** two-way — everything is opt-in and disabled by default (`fileStaging.enabled` false, no server has `staging`), and removing the config restores the previous behavior.

**Blast Radius:** stdio servers only, and only those explicitly configured with a trusted staging adapter.

- DB mode creates two tables through the existing `synchronize` path; deployments running with `DB_SYNCHRONIZE=false` need to create `file_staging_refs` / `file_staging_tokens` before enabling staging on a replica writer.
- `staging.shared` is admin-only (it makes any stdio config privileged) and re-validated on every call; a shared server without credential slots is refused.
- Per-user staging directories are **not** OS isolation: tools on the same server still run as one UID. This is documented as an operator responsibility in the ADR.
- Staging refuses to start when more than one hub process owns the same state directory (file mode) or when replica mode is active.

Part of #1056. Design: #1471. Previous slices: e906388, d7349f4.

## Schema for `DB_SYNCHRONIZE=false`

`db:setup` / a normal startup creates these through `synchronize`. A replica or deployment that disables synchronize needs this additive DDL **before** starting the new image (otherwise every server read fails on the new `servers.staging` column, not just staging calls):

```sql
ALTER TABLE servers ADD COLUMN IF NOT EXISTS staging text;
ALTER TABLE system_config ADD COLUMN IF NOT EXISTS file_staging text;

CREATE TABLE IF NOT EXISTS file_staging_refs (
  ref varchar(64) PRIMARY KEY,
  id varchar(36) NOT NULL,
  "ownerHash" varchar(64) NOT NULL,
  "serverId" varchar(64) NOT NULL,
  "serverName" varchar(255) NOT NULL,
  "toolName" varchar(255),
  filename varchar(255),
  state varchar(16) NOT NULL,
  size integer NOT NULL DEFAULT 0,
  sha256 varchar(64),
  version integer NOT NULL DEFAULT 0,
  "allowZeroByte" boolean NOT NULL DEFAULT false,
  "reservedBytes" integer,
  "createdAt" timestamp NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "leaseId" varchar(64),
  "leaseUntil" timestamp,
  "pinCount" integer NOT NULL DEFAULT 0,
  "pinUntil" timestamp
);
CREATE INDEX IF NOT EXISTS idx_file_staging_refs_owner ON file_staging_refs ("ownerHash");
CREATE INDEX IF NOT EXISTS idx_file_staging_refs_expires ON file_staging_refs ("expiresAt");
CREATE INDEX IF NOT EXISTS idx_file_staging_refs_lease ON file_staging_refs ("leaseId");

CREATE TABLE IF NOT EXISTS file_staging_tokens (
  "tokenHash" varchar(64) PRIMARY KEY,
  kind varchar(16) NOT NULL,
  ref varchar(64) NOT NULL,
  "ownerHash" varchar(64) NOT NULL,
  version integer NOT NULL DEFAULT 0,
  "contentHash" varchar(64) NOT NULL,
  "expiresAt" timestamp NOT NULL,
  "usedAt" timestamp
);
CREATE INDEX IF NOT EXISTS idx_file_staging_tokens_ref ON file_staging_tokens (ref);
CREATE INDEX IF NOT EXISTS idx_file_staging_tokens_expires ON file_staging_tokens ("expiresAt");
```

## Review follow-ups (open, not blockers)

- File-mode servers whose id is still the legacy name-derived hash are refused as staging targets; there is no automatic UUID backfill yet. A pre-existing server must get a persisted UUID (e.g. duplicate/recreate) before staging can be enabled.
- DB-mode quota/count checks are transactional but not serialized against concurrent distinct refs; the per-user/global byte quota is the primary gate.
- Removing `staging` trust from an existing server is inert rather than destructive: the adapter row can remain while no tool declares `fileStaging.enabled`, which disables rewriting. A dedicated revoke path is part of PR2's editor work.
