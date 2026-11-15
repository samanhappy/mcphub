# File staging for stdio servers — Phase 1 design (PR 1)

Status: proposed, pre-implementation. Read-only review target.
Baseline: MCPHub `origin/main` @ `8f13817` (2026-11-11; #1472 adds ~185 lines to `mcpService.ts`). Code anchors below were captured at `14d599e` and may shift; verify against the current main before implementation.
Related: issue #1056, maintainer replies 2026-11-10 and 2026-11-11 (PR #1471 review), second security/spec review 2026-11-11.

## 0. Scope

Phase 1 (PR 1) delivers the backend/API and security floor for file staging:

- per-tool `fileStaging` opt-in on stdio servers;
- owner-only staging for a single-owner server, with the same validated adapter and per-principal root as shared staging;
- shared/public staging only through an explicit **server-level trusted adapter** (`ssh` in PR 1);
- three MCP tools: `mcphub_file_upload` (inline small file **or** empty output reservation), `mcphub_file_status`, `mcphub_file_download`;
- exact `mcpfile://<uuid>` request rewrite, no heuristics and no response scanning;
- local filesystem storage under the hub cwd, principal-hash directories, UUID refs, sidecar metadata;
- authenticated structured principals, ref ownership/binding, hardened download, opaque single-use tokens, metadata-only activity logging, quotas/TTL;
- path-boundary tests, including negative tests against the real `ssh` server in a disposable instance.

PR 1's inline upload ceiling is ~1 MiB; the 100 MiB limit applies only to tool-written files. Larger user uploads wait for PR 2's browser path.

Out of scope for PR 1:

- `$smart` listing/call/describe (maintainer explicitly deferred it; PR 3);
- browser upload endpoint/page and `mcphub_file_request_upload` (PR 2);
- response-path detection / automatic `downloadUrl` injection (not planned);
- S3/MinIO, multi-node, replica mode, hosted mode (fail closed in PR 1);
- OS-level isolation, per-user UID/namespace/container (explicitly not solved);
- directory refs (files only in PR 1);
- custom/unknown shared adapters (`filesystem` adapter comes later);
- dashboard/OpenAPI virtual-tool execution (MCP-only in PR 1).

## 1. The maintainer's constraint

> Shared/public staging should require a trusted server configuration that enforces each user's staging root; credentialTemplate and cwd alone are not sufficient.

Phase 1 therefore does **not** treat `credentialTemplate` + per-user child `cwd` as sufficient for shared staging. Shared staging requires:

1. an explicit server-level trust declaration (`staging.shared`, `staging.adapter`);
2. a named adapter that validates the server's effective local-path policy is the per-user staging root;
3. no additional allowed local roots on that server;
4. the negative path-boundary tests in §11 passing for the exact server/version.

The maintainer additionally asked (2026-11-10) to keep the global heuristic path guard **out of PR 1** because it would affect unrelated stdio tools, and to document the risk from other local-file/shell tools in the same deployment. §6.2 records that decision.

If any condition is not met, shared staging is disabled. Owner-only staging remains available without the shared trust declaration, but it still requires a validated adapter and a per-principal root; there is no hub-cwd staging mode.

## 2. Trust model (option A)

### 2.1 Server config

```ts
type StagingAdapter = 'ssh'; // PR 1; 'filesystem' later

interface ServerStagingConfig {
  /**
   * Allow this server on shared/group/public routes. Default false.
   * Admin-only. Requires `adapter` and successful validation.
   */
  shared: boolean;
  adapter: StagingAdapter;
}

interface ServerConfig {
  // ...existing...
  staging?: ServerStagingConfig;
}
```

Per-tool opt-in remains:

```ts
// ServerConfig.tools[name]
{
  enabled: boolean;
  description?: string;
  hiddenParams?: string[];
  fileStaging?: {
    enabled: boolean;
    inputParams?: string[];  // tool params that accept a ready ref (read-only input)
    outputParams?: string[]; // tool params that accept a reserved ref (write destination)
  };
}
```

`inputParams` / `outputParams` are JSON Schema property names (top-level) or dot paths for nested objects. They must exist and be string-typed, must not overlap, and at least one must be present when `enabled` is true. A tool is a staging target only when the server is eligible **and** `tools[name].fileStaging.enabled === true`.

The tool flag follows existing tool-settings permissions (owner/admin). Shared trust (`staging.shared`) is admin-only and revalidated on relevant config changes. **Any staging-enabled `ssh` server, including an owner-only one, must declare `staging.adapter: 'ssh'` and pass the same adapter validation; non-ssh owner-only staging is not supported in PR 1** (there is no hub-cwd staging mode).

### 2.2 Eligibility matrix

| Server situation | `fileStaging.enabled` | `staging.shared` + adapter | Allowed? |
|---|---|---|---|
| stdio, owner-only (private, no sharedWithUsers/groups), authenticated owner | true | adapter required; `staging.shared` not required | owner-only staging |
| stdio, private but shared with users/groups | true | required + validated | shared staging |
| stdio, group/public | true | required + validated | shared staging |
| stdio, credentialTemplate but no `staging.shared` | true | absent | if private/unshared: owner-only only with a validated adapter; if group/public/shared: **staging hidden** (not owner-only) |
| non-stdio (HTTP/SSE/OpenAPI) | any | any | rejected at save and at runtime |
| stdio without per-user child, `staging.shared=true` | true | present | rejected (shared requires per-user child) |
| non-ssh owner-only (e.g. `filesystem`) | true | adapter absent | rejected in PR 1 until an adapter exists |
| unknown/custom adapter | true | `shared=true` | rejected in PR 1 |
| anonymous / skipAuth guest / synthetic session | any | any | rejected |
| system key (owner/no owner) | any | any | rejected in PR 1 (no per-user child) |

"Owner-only" means the server is visible only to its owner (and admins) and has no `sharedWithUsers` / `sharedWithUserGroups` entries. A private server that is explicitly shared is treated as shared.

Precedence: owner-only only when `visibility === 'private'` **and** no `sharedWithUsers` / `sharedWithUserGroups` after normalization. If visibility is `group`/`public`, or any shared array is present, `staging.shared` is required; otherwise staging is hidden/denied. `serverConfigPersistence` clears shared arrays unless visibility is `group`; test owner/admin/shared-user cases. Use `effectiveOwner` (legacy ownerless servers default to admin) for owner-only classification; test an ownerless server.

### 2.3 The `ssh` adapter contract

The adapter is a named, testable contract, not a generic "trust me" checkbox.

#### Validated server profile (PR 1)

- `@fangjunjie/ssh-mcp-server@1.11.0` (source-verified release used for the boundary tests).
- command/args pin the version (an unpinned `npx -y @fangjunjie/ssh-mcp-server` is not a trusted profile); **no** `--allowed-local-paths` and **no** `--config-file` (a config file could carry `allowedLocalPaths`; PR 1 fails closed on it).
- source behavior verified: `getAllowedLocalRoots()` = `[process.cwd(), ...(config.allowedLocalPaths || [])]`; `validateLocalPath` resolves and `realpath`s the path and checks it is within an allowed root. With no extra paths, the per-principal child `cwd` is the only root; `..`, absolute ancestors, and symlinks outside it are rejected by the server.
- the hub sets the child `cwd` to the per-principal staging root; `upload`/`download`/`read-file`/`write-file` enforce that root; `execute-command` is remote and outside the local boundary.
- the adapter parses the server args for `--allowed-local-paths` / `--config-file`; any occurrence disables staging (owner-only too; a future adapter may validate a config file explicitly).
- if the package/version/args differ, staging stays disabled until the boundary tests are re-run.

**Credential-template bypass (must close):** an args credential slot can be a whole argv element, so a user can bind it to `--allowed-local-paths=/` or `--config-file=/tmp/x`. `isCredentialValueAllowed` accepts any non-empty string, and config-time parsing sees only the unresolved placeholder. The adapter must therefore:

1. validate the **resolved** argv per principal after `resolveCredentialArguments` (`src/services/mcpService.ts:1916`, `src/utils/credentialTemplate.ts:7-18`), using a **strict ssh option allowlist** (host/port/username/password/privateKey/passphrase/agent/whitelist/blacklist/proxy/socksProxy/allowed-remote-paths/transport-mode/shell-ready-timeout/command-template/pty/pre-connect/mcp-transport/http-*), and reject `--allowed-local-paths`, `--config-file`, and any unknown `--*` token; or
2. restrict ssh staging to `env` credential slots only.

The target `ssh` server uses `args` slots, so PR 1 uses resolved-argv allowlist validation. Failure refuses the spawn / disables staging. The same validation applies to owner-only ssh; there is no owner-only hub-cwd fallback.

**Version check:** after connect, require `serverInfo.version === '1.11.0'` (the server advertises its version); an args-string assertion alone is not sufficient. Mismatch/unknown disables staging (shared or owner-only). The package should be pinned with an integrity/lockfile check; test a staged `config.json` in the per-principal root and a fake server that ignores cwd / adds a root — staging must stay disabled.

**Behavior change:** any ssh staging (shared or owner-only) changes the child `cwd` for **every** tool on that server, not only staging tools; relative local paths now resolve under the per-principal root. Gate this on the adapter/`fileStaging` declaration; there is no hub-cwd staging mode. The maintainer approved the shared-server cwd change as an explicit admin opt-in (2026-11-10); the owner-only owner is the only user on that server. Add a relative-path regression test for a non-staging tool on the server.

Adapter interface (so PR 3's `filesystem` adapter has a real contract):

```ts
interface StagingAdapter {
  id: 'ssh';
  validateServerConfig(config: ServerConfig): { ok: true } | { ok: false; reason: string };
  validateResolvedArgs(config: ServerConfig, principal: Principal, argv: string[]): { ok: true } | { ok: false; reason: string };
  prepareRuntime(config: ServerConfig, principal: Principal): { cwd: string };
  getStagingRoot(principal: Principal): string;
}
```

Required server shape:

- normalized stdio: `(type === 'stdio' || (!type && command)) && !url`;
- for **shared**: `credentialTemplate` present, so the runtime is a per-principal child;
- for **owner-only**: a single-owner runtime is acceptable, but its `cwd` is still set to the owner's per-principal root; no per-user child is required;
- args identify `@fangjunjie/ssh-mcp-server@1.11.0` and contain no `--allowed-local-paths` / `--config-file`;
- for **shared**: `staging.shared === true`; for **owner-only**: `staging.shared` false/absent; both require `staging.adapter === 'ssh'`;
- the server's effective local-root policy is exactly the per-principal staging root:
  - the hub spawns the child with `cwd = <stagingRoot>/<principalHash>`;
  - the server has **no extra allowed local roots** (`allowedLocalPaths`/equivalent absent or empty);
  - if the server configuration exposes an allowed-local-path setting, the adapter must parse it and reject staging if it is non-empty; unknown local-root settings fail closed.

Runtime preparation:

- create the per-principal root (`0700`) before spawn;
- pass `cwd` through the principal runtime to `StdioClientTransport` (it already supports `cwd`);
- do not add a second root through args/env;
- `execute-command` in the ssh server runs remote commands; local path tools are the boundary this adapter constrains. Document this distinction.

Validation timing:

- on server create/update/import/settings-sync when `staging.shared` or `fileStaging` is set;
- when the server type, command/args, credential template, visibility, or sharing changes;
- at startup for persisted configs;
- failure disables staging for that server (shared or owner-only) with a clear validation error; there is no hub-cwd fallback.

Residual risk (must be documented in the UI and docs):

- this is **not** OS isolation; all stdio children run as the same OS user by default, and a tool that ignores cwd/allowed roots can still read absolute paths;
- the adapter is specific to the `ssh` server version/behavior; a version/flag change requires re-running the boundary tests;
- `exec`/shell tools, symlinks, TOCTOU, and other local-file tools remain residual risks; the ssh server's per-user root is the boundary, and there is no hub-global path guard in PR1.

### 2.4 Owner-only path

Owner-only servers do not need `staging.shared`, but they still need a validated adapter and a per-principal root. In PR 1 the only adapter is `ssh`; non-ssh owner-only staging is rejected until a `filesystem` (or other) adapter exists. The owner can enable the per-tool `fileStaging` object, but the server must declare `staging.adapter: 'ssh'` and pass the same profile/argv/root validation as shared. The runtime cwd is the owner's per-principal root; there is no hub-cwd staging mode. If the server later becomes shared, admin `staging.shared` trust is also required; otherwise staging is hidden on shared routes.

## 3. Architecture

### 3.1 Why a dedicated dispatcher

The current call chain is:

`observeToolCall -> withReplicaServerScope -> withToolPolicy -> withPrincipalServers -> withModernLists -> handleCallToolRequestImpl`

An unrecognized `mcphub_file_*` name is treated as an upstream tool name by the wrappers: it can acquire unrelated per-principal runtimes, fail on unrelated credentials, refresh unrelated modern lists, or be authorized/denied by an arbitrary server's tool policy. Virtual tools must not go through those upstream-specific wrappers.

### 3.2 Call path

Add a hub-tool boundary in the exported `handleCallToolRequest`, before the existing chain:

```ts
export const handleCallToolRequest = async (request, extra) => {
  // Reserve the namespace before any upstream wrapper. `resolveHubStagingTool`
  // returns null when the name is not virtual, the route's scoped upstream owns
  // it, no staging target is eligible, or the principal/route is not eligible.
  const reservedName = isHubStagingToolName(request.params.name);
  const hubCall = await resolveHubStagingTool(request, extra);
  if (hubCall) {
    return observeHubToolCall(() => executeHubStagingCall(hubCall), request, extra);
  }
  if (reservedName) {
    // Fail closed; never fall through to withToolPolicy/withPrincipalServers.
    return rejectReservedHubTool(request, extra);
  }
  return observeToolCall(
    () => withReplicaServerScope(
      () => withToolPolicy(callToolWithPrincipal, request, extra, true),
    ),
    request,
    extra,
  );
};
```

For `$smart call_tool`, the same reserved-name check runs in the nested dispatch **before** `callToolWithReconnect`/principal acquisition; a real staging tool still uses the shared rewrite/lease helper there.

- PR 1 supports **direct virtual tool names only**. `$smart` nested `call_tool`/`describe_tool` and `search_tools` are out of scope; they must not resolve virtual tools. A real upstream staging tool called through `$smart call_tool` still goes through the shared rewrite/lease helper in `callToolWithReconnect` (§5.2).
- **Reserved namespace fails closed:** if the requested name starts with `mcphub_file_` and `resolveHubStagingTool` returns null — no eligible target, wrong caller/source, master switch off, or unknown route — the hub returns a generic rejection **before** entering `withToolPolicy`/`withPrincipalServers`/`withModernLists`. It must never fall through to upstream runtime acquisition. This applies to direct calls and `$smart call_tool` names. Test with a spy that `principalRuntimes.acquire` is not called.
- `resolveHubStagingTool` is the collision-safe gate: it resolves the route's **known** scoped upstream ownership atomically with target visibility (direct raw-name preference, `preserveToolNames`, config keys). If a known upstream tool owns a reserved `mcphub_file_*` name, staging is disabled for that route and the reserved-name rejection applies; the upstream tool is **not** called. Unknown dynamic collisions are covered by the global `mcphub_file_*` namespace reservation/fail-closed rule (§3.3), not by guessing the dynamic catalog without runtimes.
- The resolver checks hosted/replica and the MCP source flag **before** any scope or runtime acquisition; it never spawns an upstream child just to answer a virtual call.
- `executeHubStagingCall` resolves the principal, the route's staging targets, and the ref; it does not acquire upstream runtimes, does not refresh upstream lists, and does not run upstream tool policy.
- Hub-tool authorization is explicit: master switch on, principal authenticated, route target eligible, per-tool flag on, server visibility/trust valid, ref owner/binding valid. This is the hub capability; it is not derived from an arbitrary server's tool policy.
- Metrics/activity labels are fixed (`mcphub`/hub tool name), not `unknown`.
- Replica/hosted mode: refuse before execution; no local staging in multi-process modes.

### 3.3 List path

For non-`$smart` routes, `handleListToolsRequestImpl` -> `listGroupTools` remains the upstream list path. At the end of `listGroupTools` (after the existing `filterToolsByConfig` + `filterToolsByGroup` + `findToolConfig` + projection), append the virtual tool definitions **once** if the route has at least one staging target. Deduplicate per scope.

`listGroupTools` must take an explicit `includeVirtualTools` option (default **false**). Only the ordinary non-`$smart` list projection passes `true`. The `$smart` pinned-tools builder (`src/services/mcpService.ts:4352-4367`) and the `preserveToolNames` dispatch validation (`:4107-4113`) pass `false`; otherwise virtual tools leak into `$smart` or become reservable through `resolveToolInGroup`.

Compute the targets independently of `serverInfo.tools.length`; the config-only fallback in §3.4 is what makes a credential-templated `ssh` server visible even when its global catalog is empty. Do not gate virtual-tool injection on the upstream tool loop having run.

- `$smart` routes are unchanged: only meta-tools/pins; no virtual tools in PR 1.
- Virtual definitions are hub-level names; they are not prefixed by `projectGroupToolName`.
- Reserve the `mcphub_file_*` namespace globally for **all** servers. At create/update/import/sync, reject a server whose **known** tool catalog contains a `mcphub_file_*` name (or explicitly disable that tool); a staging-enabled server with a collision is rejected. If a dynamic catalog introduces a collision, staging is disabled for that route (fail closed), the reserved name is rejected, and the upstream tool is not called — do not silently shadow or guess. This is the "reserve/reject globally" option, chosen because the top-level dispatcher cannot reliably obtain a per-principal dynamic catalog without acquiring upstream runtimes.
- `assertValidGroupToolNames` (`src/utils/groupToolNames.ts:17-26`) must reserve `mcphub_file_*` (or explicitly exclude virtual names); otherwise a group alias can shadow a virtual tool. Run the reserved-name check on every projected group name, not only when `preserveToolNames` is set. Add a group-alias collision test.
- The top-level resolver still checks **known** scoped upstream ownership before hub dispatch (direct raw-name preference, `preserveToolNames`, config keys); unknown dynamic collisions are prevented by the namespace reservation/fail-closed rule. Test direct/group/config/dynamic.
- When `routeHasStaging`, force the list to generated/`ttlMs=0` (or add virtual-exposure inputs to the cache fingerprint). `withCacheHints` currently only forces that for `$smart`/builtins/hosted (`:6086-6099`); do not rely on the existing behavior. Reuse `listProjectionInputs` (`:6010-6050`) for DAO/user/key/runtime config and add staging exposure; add a cache test.

### 3.4 Scope helper

One helper is the source of truth for list and dispatch:

```ts
interface StagingTarget {
  serverName: string;
  serverId: string;        // required stable id; random UUID, never name-derived for refs
  toolName: string;        // runtime/bare name
  configKey: string;       // key in ServerConfig.tools
  shared: boolean;
  cwd: string;             // actual child cwd: per-principal root (shared or owner-only)
}

async function getStagingTargets(group: string | undefined, principal: Principal): Promise<StagingTarget[]>
```

It must use the real scoped pipeline, not a config-only scan:

1. `getFilteredServerInfosForGroup(getGroupLookupName(group))` for route visibility and group configs;
2. for each server, eligibility (§2.2): normalized stdio; owner/shared rules; `staging.adapter` validation for **any** ssh staging; `credentialTemplate` required only for shared; non-ssh owner-only rejected in PR 1;
3. `filterToolsByConfig(server.name, server.tools)` and `filterToolsByGroup(group, server.name, tools, groupConfig)` when the scoped catalog is available;
4. `findToolConfig(serverConfig.tools, server.name, tool.name, runtimeNames)` with the complete scoped runtime-name list;
5. config-only fallback when a per-principal catalog is empty and the server is an eligible owner-only/shared staging target (the credential-templated `ssh` case):
   - consider `serverConfig.tools` entries with `fileStaging?.enabled === true` and `enabled !== false`;
   - apply the group selection using the original server-prefixed names (`tools: 'all'` or includes);
   - normalize the config key to the runtime/bare name;
   - this is only for eligibility/listing; the actual tool call still resolves the real upstream target before rewriting. A non-templated server uses its runtime catalog; dispatch reconciles the config target with the actual runtime target and rejects a nonexistent/unbound target.
6. `$smart`: not called in PR 1.

`serverId` is required for ref binding; if a server has no stable id, persist one or fail closed — a name alone can collide after delete/recreate.

The helper must not read the global runtime's empty placeholder catalog as "no tools" for a credential-templated server. The config-only fallback is the explicit answer to that case.

### 3.5 Non-MCP entry points

- Dashboard `toolController` wraps calls as nested `call_tool`; OpenAPI uses a synthetic session. PR 1 rejects `mcphub_file_*` there (MCP-only) and must not fall through to upstream runtime acquisition.
- The rejection must use an explicit transport/source flag set by the MCP transport, not the session-ID string: a caller can spoof `x-session-id` and bypass a synthetic-ID check. Require `source === 'mcp'`; set it in the actual MCP handlers and default REST/OpenAPI to non-MCP. Test `/api/tools/call` and `/api/tools/:server/:tool` with a spoofed header **before** any principal acquisition.
- Generated OpenAPI specs will not list virtual tools; document.

### 3.6 Runtime invalidation and child cwd

- `staging` and the effective per-principal root are **connection-relevant**. Add `staging` to the connection-config fingerprint (`src/controllers/serverController.ts:251-270`) so a save/update cannot take the fast path at `:1336-1358`; `updateServerInfoVisibility` (`src/services/mcpService.ts:680-703`) changing only visibility is insufficient.
- If `cwd` affects discovery, include it in `prepareCapabilitySnapshot`'s fingerprint (`capabilitySnapshotService.ts:86` currently uses `[1, launch, env, scope.revision]`) or bypass the snapshot cache for staging targets; test a cwd change with a warm snapshot.
- `createPrincipalRuntime` (`:5597-5651`) currently drops the scope before `createTransportFromConfig`; `CapabilityScope` (`src/services/capabilitySnapshotService.ts:11-14`) only has `{username, revision}`. Carry `cwd`/principal root through the scope, transport creation, and `StdioClientTransport`; replace the hardcoded `cwd: process.cwd()` (`:1911-1920`) for **any** staging-enabled server (shared or owner-only).
- On staging/visibility/type/credential/package/version/args changes: invalidate the principal runtimes; revalidate the definition/version/root after connect and **before every rewrite/finalize**; fail closed on downgrade (shared→owner/public, adapter removal, version mismatch).
- On revoking staging/shared trust: no new leases/rewrites; an in-flight call that already holds an output lease may finish and finalize, but its next validation fails; existing `ready` refs remain owner-downloadable until TTL/server deletion; `reserved` refs are failed/cleaned. Test revocation during an in-flight call and after ready.
- Tests: staging true→false (shared or owner-only), adapter/package/version/args/credential changes while a child exists, owner→public, disconnect/restart; assert no old-cwd use and no cross-user ref.

## 4. Storage and refs

### 4.1 Layout

```
<process.cwd()>/data/uploads/staging/
  <principal-hash>/                 # 0700
    <uuid>/                         # 0700
      content                       # 0600, fixed internal name
      meta.json                     # 0600, atomic write
```

- `principal-hash = sha256("<kind>:<stable-id>")`, hex. **Require a stable principal id** (`User.id`/`ssoUserId`; add it to the principal — `toIUser` currently drops the DB id). If unavailable, use a per-user random salt stored in the user record; do not derive from the username alone, or a deleted/recreated/renamed user inherits the old root. Staging (shared or owner-only) is disabled when neither is available. Never use a raw username, email, hosted userId, or forward-auth claim as a path component.
- PR 1 includes a **user identity migration/backfill** for DB and file users: add the id/salt, backfill every existing user, allocate the salt race-safely on first use, and store no plaintext raw ids in metadata. Test existing DB/file users without id/salt, concurrent first use, delete/recreate, and rename.
- `uuid` is a v4 UUID; strict regex.
- The original filename is display metadata only; never a path component.
- `content` is opened with `O_NOFOLLOW`; `lstat`/`fstat` check regular file; no symlinks; `nlink === 1` is mandatory for tool-produced files. `O_NOFOLLOW` is leaf-only: `realpath` or `O_DIRECTORY|O_NOFOLLOW` every parent component (`<base>`, `<principal-hash>`, `<uuid>`) and compare to the canonical root.
- Directory creation uses `mkdir` with `0700` and the same parent checks; do not `mkdir -p` through a pre-created symlink; `lstat` each component before and after creation.
- `path.resolve` + `path.relative` containment checks; no string `startsWith`.
- **Authoritative state is hub-side**, not the tool-writable `meta.json`: use a DB `file_staging_refs` table in DB mode and a hub state file in file mode; treat `meta.json` as a cache and cross-check owner/state/hash/version at finalize and download. A malicious/buggy tool can rewrite its own `meta.json`; add a tamper test.

### 4.2 `meta.json`

```json
{
  "ref": "mcpfile://<uuid>",
  "owner": { "kind": "user", "id": "<hash>" },
  "serverId": "...",
  "serverName": "...",
  "toolName": "...",
  "filename": "display-name.bin",
  "size": 123,
  "sha256": "...",
  "state": "reserved|ready|failed|expired",
  "version": 1,
  "createdAt": "...",
  "expiresAt": "..."
}
```

- No plaintext token, no absolute path.
- Atomic writes: temp file + fsync + rename; directory fsync where supported.

### 4.3 State machine

`reserved -> ready | failed | expired`

- `reserved`: created by upload-without-content; the file exists zero-byte and is the tool's output destination. A `reserved` ref is **not a valid input**; only `ready` refs can be rewritten as inputs.
- **Output lease (required):** before rewriting any `outputParams` and before calling upstream, atomically acquire an exclusive lease on **every** reserved ref used as an output in this call. Use one conditional update/lock for the full set (e.g. `UPDATE ... WHERE ref = ANY($refs) AND state='reserved' AND lease_id IS NULL AND expires_at > now() RETURNING ref`); require the complete set, and release any partial acquisition in `finally`. Do not hold a DB transaction across the upstream call. If any lease cannot be acquired, reject the whole call before any upstream invocation. Hold all output leases through finalization; release on success, failure, or cancellation. A finalizer-only CAS is insufficient: without a pre-call lease, two calls can both rewrite and write the same reserved destination, and the loser only discovers the conflict after upstream. Only the lease holder may rewrite/finalize that ref.
- **Lease lifetime (single-process PR 1):** leases do not expire while the hub process is alive. `lease_until` is a diagnostic/crash backstop, not a runtime TTL; a second call cannot acquire a ref whose `lease_id` is set, regardless of `lease_until`. On startup, every leased `reserved` ref is marked `failed` (terminal), its lease cleared, and its UUID is never reused; quarantine/delete only after orphan handling. The state store uses a lockfile/instance id; if a second process holds it, staging refuses to start. If multi-process mode is added later, use heartbeat renewal plus confirmed-dead takeover, never a bare TTL.
- **Read pins:** ready inputs and downloads take a read pin (`pin_count`/`pin_until`), not the exclusive output lease. Cleanup skips pinned refs; release in `finally`. A long `ssh upload` or slow download must not lose its content to TTL.
- **Quota at lease:** reserve `maxFileBytes` (or a per-call cap) against the per-user/global quota when the output lease is acquired, check `statfs` before upstream, and cap concurrent leased outputs; reject 507/429 before the child writes. Adjust the reservation at finalize. This is the actual quota gate; finalize-only accounting is not a cap.
- After the upstream tool call returns, the hub finalizes exactly the refs actually rewritten as output destinations, in a `try/finally`:
  - confirm this call still holds the lease; finalize and release in one conditional update (`UPDATE ... WHERE ref=:ref AND lease_id=:call`), check exactly one row; `ready` refs are read-only and cannot be reused as output destinations;
  - the file exists, is regular, and is either non-empty or explicitly allowed zero-byte (`allow_zero_byte: true` on `upload`; default false);
  - size/hash recorded; `version++`; state `ready`; release the lease;
  - if the tool failed, threw, or the call was cancelled, or the file is missing/partial/oversized, state `failed`, release the lease, and schedule cleanup.
- `upload` with inline content transitions directly to `ready`.
- A tool that writes asynchronously after returning is not supported; `status` remains `reserved` until explicit cleanup; leases have no runtime TTL in PR 1; document.
- `expired`: TTL cleanup; active output leases and read pins prevent deletion.
- `status` reports state/size/hash/expiry; never the absolute path.
- Download requires `ready`; reserved/partial/failed/expired return 404/409/410.
- Quota is **not** a hard boundary against a misbehaving child: reserve/check at lease and again at finalize, but the child has the same UID and can exceed the reservation. Document the disk residual; a separate FS/quota or preallocation is future work.

### 4.4 Limits

Global defaults (overridable; PR 2 UI):

| Setting | Default |
|---|---|
| master `enabled` | false |
| `maxFileBytes` | 100 MiB (browser/tool-written files) |
| `inlineMaxBytes` | min(1 MiB, `jsonBodyLimit * 0.75 - overhead`) |
| `perUserQuotaBytes` | 1 GiB |
| `globalQuotaBytes` | 10 GiB |
| `ttlHours` | 24 |
| `maxFilesPerUser` | 100 |
| `downloadTtlSeconds` | 300 |
| `cleanupIntervalMinutes` | 15 |

- Inline `content_base64` is small-file only; 100 MiB is never claimed for inline MCP JSON.
- Reserve/actual bytes count against quota; atomic ledger; 507 when full; `statfs` safety margin.
- Startup sweep for expired/temp/orphan files; no deletion of leased/pinned files; startup marks every leased `reserved` row failed.
- Per-principal and global caps; max pending uploads (PR 2), max concurrent downloads.

PR 1 quota floor is deliberately small: per-file cap, per-user cap, global cap, TTL, and a `statfs` safety check. There is no separate quota service or quota UI in PR 1; the Settings UI is PR 2.

### 4.5 Ref ledger and token store

This is a third persistence area (beyond the per-tool `tools` JSON and the server `staging`/system `fileStaging` columns) and must be designed explicitly.

DB mode:
- `file_staging_refs`: `ref` PK, `owner_hash`, `server_id`, `tool_name`, `state`, `size`, `sha256`, `version`, `allow_zero_byte`, `created_at`, `expires_at`, `lease_id`, `lease_until`, `pin_count`, `pin_until`, `updated_at`; unique `(ref, version)`; indexes on owner/expiry/lease.
- `file_staging_tokens`: `token_hash` PK, `kind` (`download`/`upload`), `ref`, `owner_hash`, `version`, `content_hash`, `expires_at`, `used_at`; atomic consume with `UPDATE ... WHERE used_at IS NULL RETURNING ...`; the consume-time check binds the ready version/hash; cleanup.
- Additive migrations + DAO/entity/map columns; transactions for finalize/consume; no ref is served if the ledger row is missing. `DB_SYNCHRONIZE=false` needs an explicit migration path (the current setup assumes `synchronize:true`); add a migration and test both modes.

File mode:
- `data/staging-state/refs.json` + `tokens.json`, `0600`, atomic temp+rename+`fsync`, per-process lock/cross-request lock, plus a **lockfile/instance id**; if a second process holds the lock, staging refuses to start (no cross-process lease). Or a small SQLite store. Do **not** reuse the non-atomic `JsonFileBaseDao` writeFileSync path; do not put authoritative state under the tool-writable staging root. Same-UID tools can still write arbitrary paths; this is the documented cross-tool residual, not a hub-global guard.
- Backfill a **random UUID** for every file-mode server. Never use a name-derived server id for ref binding (delete/recreate the same name would reuse the id); if no UUID can be persisted, staging fails closed.
- Token values are stored hashed; restart behavior and cleanup are defined.

Recovery/concurrency:
- Startup reconcile ledger vs `content`/`meta.json`; every leased or `reserved` row becomes `failed` (terminal), its lease is cleared, and its UUID is never reused; quarantine/delete only after orphan handling. Orphan children can outlive the hub, so do not re-lease or overwrite the same destination after restart.
- Output refs use an exclusive lease acquired **before** argument rewrite and upstream call, held through finalization; one lease holder per reserved ref; `ready` read-only with a read pin for inputs/downloads; one-time token consume; parallel tests.
- File/DB parity tests; tamper test; no serving without ledger.

## 5. Tool surface

### 5.1 PR 1 tools

```
mcphub_file_upload(filename, content_base64?, server?, allow_zero_byte?)
mcphub_file_status(ref)
mcphub_file_download(ref)
```

`mcphub_file_request_upload` is **not listed** in PR 1; it ships with the PR 2 browser endpoint/page.

### 5.2 Semantics

- `upload`:
  - `filename` is sanitized for display; reject NUL/CR/LF; cap 255 bytes; never a path.
  - `content_base64` present: decode, enforce `inlineMaxBytes`, write `content`, state `ready`; `server` optional if the route has one staging target.
  - `content_base64` omitted: create a zero-byte `reserved` ref for tool output; return the ref.
  - `allow_zero_byte` (default false): permit a zero-byte **output** to finalize as `ready`; without it, zero-byte outputs are `failed`. It does not apply to `reserved` inputs.
  - `server` is required when the route has more than one staging target; it must be one of them. `upload(server=<a non-staging server>)` is rejected; a ref cannot be created for a server that is not a staging target.
- `hiddenParams` must not overlap `inputParams`/`outputParams`; reject at config validation (the rewrite happens after hidden-argument removal).
- Master switch off: virtual tools are hidden and `mcphub_file_*` calls are rejected before any upstream runtime acquisition.
- `status(ref)`: `{state, size, sha256, expiresAt}`; no path.
- Virtual tool calls log metadata only (`tool`, ref hash, state/size); never `content_base64`, download URL, filename, or absolute path.
- `download(ref)`: `{downloadUrl, expiresAt}`; owner/binding/state checked; short-lived URL; no path.
- Errors are generic: foreign/expired refs use the same 404; no existence oracle.
- Staging-enabled tools must declare at least one string param; `enabled` with no params is rejected at config validation.
- `inputParams` accepts only `ready` refs; `outputParams` only `reserved` refs. A `reserved` ref in an input param, a `ready` ref in an output param, or the same ref in both is rejected before the upstream call.
- Before rewriting and calling upstream, acquire an exclusive lease on **every** `reserved` output ref in the call, atomically. If any ref is already leased, reject the whole call before upstream; the competing call must not reach the tool. Hold through finalization; release on success/failure/cancel.
- After the call, finalize exactly the reserved refs passed in `outputParams` (in `try/finally`); a thrown/cancelled call marks them `failed` and releases their leases.
- Examples: `ssh upload` uses `inputParams: ['localPath']` (the local source is read); `ssh download` uses `outputParams: ['localPath']` (the local destination is reserved). `remotePath` is not a staging param.

### 5.3 Ref binding

- At creation a ref is bound to `{owner, serverId}`; `serverId` is a stable random UUID persisted on every server, including file mode. `toolName` is unknown until the first tool use; record it at first rewrite/finalization for audit and do **not** enforce tool-level binding in PR 1 — the server is the trust boundary. `version` increments when content becomes ready; download tokens bind the ready version/hash.
- Rewrite resolves the actual target server/tool first, then checks owner and server binding; a ref uploaded for server A is not usable by server B.
- When the route has one staging target, `server` is inferred; with multiple, explicit.
- System keys are rejected for staging in PR 1 (see §7); refs are user-owned.
- Foreign/expired/renamed/recreated targets: generic 404.

## 6. Request rewrite and PR 1 boundary

### 6.1 Rewrite

- Only for a staging-enabled target, after target resolution.
- Exact string match `mcpfile://<uuid>` (no substring, no heuristics, no response scanning).
- Resolve the ref to `<principalRoot>/<uuid>/content`; check owner/binding/state/version.
- Replace only that string in the tool's **declared `inputParams` / `outputParams`**. A `mcpfile://` value in an undeclared parameter is rejected, not rewritten. `inputParams` accepts only `ready` refs; `outputParams` accepts only `reserved` refs; a ref cannot appear in both in one call.
- Nested `$smart`/`call_tool` is out of scope for **virtual** tools in PR 1; dashboard/OpenAPI are MCP-only reject. A **real upstream staging tool** called through `$smart call_tool` still passes through the same rewrite/lease helper.
- **Single interception point:** put the rewrite/lease/finalize helper in `callToolWithReconnect` after `withoutHiddenArguments` (where both the regular call at `mcpService.ts:5035` and the `$smart call_tool` path at `:4814` converge), not in two duplicated branches. This keeps the lease/finally logic in one place and guards both call sites. Test both.
- There is no hub-global path guard in PR 1 (§6.2).
- When any argument is rewritten, the upstream call's activity log must use an **explicit `suppressPayload` flag** on `ActivityLoggingService.logToolCall` (this option does not exist today; add it) or equivalent redaction. This applies to owner-only and shared servers (the upstream `finalArgs` contains the absolute `content` path). Add owner-only/shared log tests; the current regular call logs request arguments at `:5008-5023`.
- `content_base64` is not a path; no path scanning in PR 1.

### 6.2 No global heuristic path guard in PR 1 (maintainer decision)

The maintainer asked to keep the global heuristic path guard out of PR 1 because it would affect unrelated stdio tools. PR 1 therefore:

- does **not** scan unrelated stdio arguments and does **not** reject raw absolute paths at the hub;
- rewrites only exact `mcpfile://` values in the tool's declared `inputParams` / `outputParams`; no heuristics, no response scanning;
- relies on the trusted ssh server's own per-user root: it resolves local paths against its cwd and rejects paths outside the per-user root; the hub sets cwd per principal for **both** shared and owner-only ssh staging;
- there is no owner-only hub-cwd fallback: owner-only ssh uses the owner's per-principal root and the same adapter validation.

**Documented risk (accepted for PR 1):** another stdio server with local-file or shell access in the same deployment can read the staging tree; all stdio children share the OS user/root by default. The hub does not guard those tools. Admins must restrict/remove such tools or accept the risk. There is no OS isolation. This is an explicit residual, not a claim of safety; a future PR can add a scoped/opt-in guard or isolation.

The §11 tests therefore cover the ssh server's own boundary (upload/download/read-file/write-file outside the per-user root; credential args; version; cwd) plus ref-parameter enforcement. Hub-global path-guard tests are deferred.

## 7. Authentication and principal

Resolve a structured principal from the authenticated request context:

- prefer `UserContextService`/`RequestContextService` user; never `extra.username` or `sessionId`;
- require a real user-scoped principal (`keyKind === 'user'` / a `UserContextService` user object). Reject a system key **before** any username fallback: `src/middlewares/auth.ts:129-133` sets `username: matchingBearerKey.owner || 'system'`, so a system key with an owner must not be mapped to that user through `RequestContextService`;
- reject when:
  - no authenticated user;
  - bearer auth is disabled and the request is anonymous;
  - `skipAuth` guest / synthetic dashboard (`api-session`, `openapi-session`);
  - `credentialEligible === false`;
  - the user is deleted/unknown, or the key scope/group does not cover the target server;
  - hosted mode or replica mode;
  - the route `:user` does not match the authenticated user (existing middleware; re-check).
- **system keys are rejected for staging in PR 1**: they have no per-user child, cannot use credential-templated servers, and would create unusable refs. Do not map a system-key owner to a user; require a user-scoped key.
- OAuth/forward-auth: canonical local user. OAuth token scopes are currently discarded (`src/utils/oauthBearer.ts:11-29`; `RequestContext` has no scope), so PR 1 **documents that write scopes are not enforced** and relies on user identity; PR 2 propagates scopes. This is a known residual, not a hidden claim.
- One eligibility predicate is shared by list and dispatch; tests: system key (owner/no owner), guest, `:user` mismatch, revoked group, deleted user, `credentialEligible:false`.
- `staging` list/execute is hidden or rejected when no principal is eligible.

## 8. HTTP endpoints

### 8.1 Download (PR 1)

`GET /staging/download/:token` — registered **outside `/api`** (the `/api` middleware applies dashboard auth), before the SPA catch-all, with a dedicated rate limiter.

- token: 32 random bytes, base64url; store only `sha256(token)` in an atomic store (DB table or a process-safe file store; define restart/cleanup behavior); TTL 300 s; one-time atomic consume; bind to `{ref, version, hash, owner, expiresAt}`; a `HEAD` must not consume the token; reject/ignore `Range`;
- response headers:
  - `Content-Type: application/octet-stream`
  - `Content-Disposition: attachment; filename="<sanitized ascii>"; filename*=UTF-8''...` (`filename` strips quotes/backslashes/CR/LF, fallback `download.bin`)
  - `X-Content-Type-Options: nosniff`
  - `Content-Security-Policy: default-src 'none'; sandbox`
  - `Cache-Control: private, no-store`
  - `Referrer-Policy: no-referrer`
  - `X-Robots-Tag: noindex`
- open `content` with `O_NOFOLLOW`; `fstat` regular; `nlink === 1`; **realpath / `O_DIRECTORY|O_NOFOLLOW` every parent component** (`<base>`, `<principal-hash>`, `<uuid>`) and compare to the canonical root; size/hash must match the ready record; verify the hash incrementally while streaming (or prehash once with a size cap) and abort on mismatch; serve from the fd; no range; no inline; no MIME from the filename; do not use `res.sendFile`.
- URL is built with `resolveInstallBaseUrl(systemConfig, undefined)` — **no Host/Host-fallback**; require a configured base URL and reject the default `http://localhost:3000` for staging links. Join the configured basePath; keep the route before the SPA catch-all and on a dedicated limiter. Test `Host`/`X-Forwarded-Host` spoof, missing config -> no URL, and GET/HEAD through the global middleware (`src/middlewares/index.ts:36-64`).
- one-time token: a browser retry needs a new `download` call; document.

### 8.2 Upload (PR 2, not PR 1)

- one-time token; standalone HTML page, no dashboard bundle/localStorage/cookies; strict CSP; token in the URL fragment, exchanged via `POST` with a custom header/Authorization; `Origin`/`Sec-Fetch-Site` check; no-referrer/no-store/noindex; stream multipart to disk; enforce actual bytes, not `size_hint`.
- `mcphub_file_request_upload` is listed only in PR 2.

## 9. Configuration and persistence

### 9.1 Per-tool `fileStaging`

Add `fileStaging?: { enabled: boolean; inputParams?: string[]; outputParams?: string[] }` to every tool-config shape:

- `src/types/index.ts` (ServerConfig.tools);
- `src/dao/ServerDao.ts` and `src/dao/ServerDaoDbImpl.ts` updateTools types;
- `src/db/entities/Server.ts` tools JSON shape;
- `src/controllers/serverController.ts` create/update/toggle types;
- `frontend/src/types/index.ts` ServerConfig and Tool.

The `tools` column is `simple-json`; the object itself needs no new column. But it can be silently dropped or omitted on some round-trips unless all paths are fixed:

- `src/utils/settingsSync.ts` Zod nested object only allows `enabled`/`description`/`hiddenParams`; add the `fileStaging` object (`enabled`, `inputParams`, `outputParams`);
- `frontend/src/utils/serverFormPayload.ts` `buildServerPayload` currently omits `tools`; round-trip or server-side merge (opaque carry). Note: `ServerDaoDbImpl.update` uses `hasOwn` and the file `updateEntity` shallow-merges, so an absent `tools` is preserved on the server side; the dashboard omission is still a round-trip bug and must be fixed explicitly;
- `src/controllers/serverController.ts` `updateServer` persists the normalized config; do not let an edit wipe `tools`; normalize an explicit `tools: undefined` to **absent** before the DAO (the DAO's `hasOwn('tools')` would otherwise write null);
- `src/utils/serverConfigPersistence.ts` `normalizeServerConfigForPersistence` spreads `tools`; validate `fileStaging.enabled`/param arrays and reject empty/overlapping/nonexistent params when enabled; do the same absent-vs-undefined normalization for `staging`;
- duplicate/template/migration paths copy `tools`; revalidate/clear `staging.shared` on duplicate to avoid accidental trust.

### 9.2 Server-level `staging`

- Add `staging?: { shared: boolean; adapter: 'ssh' }` to backend/frontend ServerConfig.
- DB: add a nullable `simple-json` `staging` column to the `servers` table (additive migration) and map it in `src/db/entities/Server.ts` / both DAOs; file mode persists it in the server JSON. Do **not** assume an existing generic server-config JSON column carries it.
- `settingsSync` schema; dashboard create/edit payload round-trip; `presentServerForPrincipal` safe view: include `staging` only as an admin/owner read-only summary, or omit; never expose secrets (there are none).
- Validation on create/update/import/sync/type change/visibility change; clear or reject.
- `staging.shared` is admin-only on **all** create/update/import/sync/batch routes, not only a dedicated PATCH; per-tool `fileStaging` follows existing tool-settings permissions (`loadAuthorizedServer`: owner/admin). A shared server with `fileStaging` but no admin-approved `staging.shared` is hidden, never owner-only. Document the split and the curl/API path.
- `staging.adapter` is required for **any** ssh staging (owner-only included) and is validated against the pinned profile. An owner may configure it on their own private server; an admin may configure it on a shared server. There is no owner-only staging path that skips adapter validation.

### 9.3 Tool metadata projection

`config.tools` is stripped from the normal server-list projection (`mcpService.ts:3035-3052`), and the frontend `Tool` type lacks the flag. Add `fileStaging` to the tool projection (`mcpService.ts:768-778`) and frontend `Tool`; `ToolCard` must not depend on `server.config.tools` being present.

### 9.4 Global settings

Add a validated `fileStaging` section to `SystemConfig`:

```ts
fileStaging?: {
  enabled: boolean;
  maxFileBytes: number;
  inlineMaxBytes: number;
  perUserQuotaBytes: number;
  globalQuotaBytes: number;
  ttlHours: number;
  downloadTtlSeconds: number;
  uploadTtlSeconds: number; // PR 2
  maxFilesPerUser: number;
  cleanupIntervalMinutes: number;
};
```

- `src/controllers/serverController.ts` `updateSystemConfig` destructures a fixed set and has a no-valid-update guard; add `fileStaging` to both and assign before DAO update/cache replacement.
- DB `src/db/entities/SystemConfig.ts` uses fixed columns; add a nullable `simple-json` `fileStaging` column + DAO projections + migration (additive). Do **not** claim "no migration" for global settings.
- File-mode config; JSON→DB migration whitelist if needed.
- PR 1 exposes the settings via API; PR 2 Settings UI.

### 9.5 API

- `PATCH /servers/:name/tools/:tool/file-staging` (or a dedicated route) with `{ enabled, inputParams?, outputParams? }`; **owner/admin** (existing tool-settings permission); preserve the rest of the tool config; validate params against the tool input schema; patch live config; `broadcastToolListChanged`.
- `PATCH /servers/:name/staging` with `{ shared, adapter }`; **`shared` is admin-only**; an owner may set `adapter` on their private server through the normal server update path, but the adapter is validated; persist; broadcast.
- All create/update/import/sync/batch routes enforce the same admin-only rule for `staging.shared`; a non-admin edit cannot add trust. Document the exact curl/API path for the UI-less PR1.
- `GET` surfaces the flag on tool metadata and the server's staging summary for admins.

### 9.6 Template, migration, DAO, and replica inventory

The `tools` JSON is only one persistence path. Add/validate `staging` and `fileStaging` in:

- `src/services/templateService.ts:354-427` explicit whitelist (it copies `tools` at `:387` but would drop `staging`); **PR 1 template export intentionally excludes `staging` trust**; import revalidates. Document this in the ADR; if exported later, admin-only and revalidated.
- `src/utils/migration.ts:148-175` JSON→DB server whitelist and `:209-225` system `fileStaging`.
- `src/dao/ServerDaoDbImpl.ts:93-120`, `:149-175`, `:289-358` create/update/map columns.
- `src/services/mcpService.ts:6267-6273` replica projection (`tools`/`prompts`/`resources`) if `staging` is surfaced; otherwise explicitly exclude it and revalidate local configs.
- Tests: template export/import, JSON→DB migration, duplicate/template/batch, DB/file parity, safe vs full projection (`serverConfigPresenter.ts:20-30`), no silent trust creation.

## 10. UI (PR 2)

- Server card/detail:
  - admin-only **"Allow shared staging"** checkbox + adapter (`ssh`) + warning that this is a server-enforced boundary, not OS isolation;
  - owner-only ssh: adapter selector/validation state (owner may configure; no `staging.shared`), with a clear "no hub-cwd staging" warning;
  - per-tool **`fileStaging`** control next to enabled/description/hiddenParams: enable + select `inputParams` / `outputParams` from the tool's string input-schema properties; `readOnly` when not manageable; sync local state on prop changes;
  - badge on staging-enabled tools/servers; show the direction (input/output) per param.
- Settings → File Staging: master switch, limits, TTL, quotas.
- No pseudo-server and no separate top-level Built-in Tools page in the MVP; promote later if multiple built-in tool families exist.
- i18n strings in all loaded locales (`en`, `vi`, `zh`, `fr`, `tr`, `es`); docs.

## 11. Path-boundary tests

These are acceptance blockers; run against the exact `ssh` server version in a disposable instance, never production.

### 11.1 Hub-side unit tests

| Case | Expected |
|---|---|
| ref exact match / substring / uppercase variants | exact only |
| ref traversal (`mcpfile://../...`, non-UUID) | rejected |
| foreign/expired ref | generic 404 |
| ref bound to another server | rejected |
| ref used by another tool on the same server | allowed + audit (server-only binding) |
| cross-principal ref | rejected |
| `mcpfile://` in an undeclared param | rejected |
| ready ref in `outputParams` | rejected (read-only) |
| reserved ref in `inputParams` | rejected (not ready) |
| same ref in input and output | rejected |
| tool enabled with no `inputParams`/`outputParams` | config rejected |
| param name not in the tool input schema | config rejected |
| overlapping input/output param | config rejected |
| reserved/partial/failed download | 404/409/410 |
| file replaced after ready | hash mismatch, reject |
| hardlink to another file | reject (nlink > 1) |
| quota exceeded | 507 |
| quota reserved at lease | second output lease rejected before upstream |
| TTL/cleanup while leased/pinned | not deleted |
| master switch off | virtual tools hidden; call rejected before upstream |
| `upload(server=<non-staging>)` | rejected |
| `hiddenParams` overlaps input/output | config rejected |
| output lease conflict (two calls) | second rejected before upstream; one invocation |
| crash/restart orphan | swept/failed, not served/reused |
| owner-only adapter validation fails (argv/version/extra roots) | staging disabled; no hub-cwd fallback |
| owner-only A reads `/app/mcp_settings.json` / `/app/data/uploads/staging/<userB-hash>` | rejected |

### 11.2 `ssh` integration tests (disposable instance, shared profile)

These assert the **ssh server's own** per-user root. Owner-only staging uses the owner's per-principal root, not the hub cwd; the settings file and other principals' roots are outside it. Add an owner-only test: user A's ssh cannot read `/app/mcp_settings.json` or `/app/data/uploads/staging/<userB-hash>/...`.

| Call | Expected |
|---|---|
| `upload(localPath='/app')` | rejected (outside the per-user root) |
| `upload(localPath='/app/data')` | rejected |
| `upload(localPath=<staging base>)` | rejected (outside the per-user root) |
| `upload(localPath='..')` | rejected |
| `upload(localPath='.')` / own per-user root | allowed (own directory); document |
| `upload` directory within the per-user root | allowed; document |
| `upload` symlink pointing outside the root | rejected |
| `upload(localPath=<another user's root>)` | rejected |
| `upload` legitimate file inside the per-principal root | succeeds |
| `download(localPath='/app/data/mcp_settings.json')` | rejected |
| owner-only A `upload(localPath='/app/mcp_settings.json')` | rejected (outside A's per-principal root) |
| owner-only A `upload(localPath='/app/data/uploads/staging/<userB-hash>/...')` | rejected |
| owner-only A `download(localPath='/app/mcp_settings.json')` | rejected |
| `download(localPath='../...')` / ancestor | rejected |
| `download` into a reserved ref destination | succeeds, then `status=ready`, `download` works |
| `read-file`/`write-file` outside the allowed root | rejected |
| `read-file`/`write-file` inside the per-principal root | succeeds |
| user B uses user A's ref/path | 404/rejected |
| user B's cwd relative traversal `../<userA-hash>/...` | rejected |
| staging path passed to a non-staging stdio server on the same route | **allowed in PR1** (no global guard); documented risk; admin must restrict/accept |
| another local-file/shell tool reads `/app/data/uploads/staging` | **allowed in PR1**; explicit documented residual, not a test failure |
| shared server: non-staging tool with a relative local path | resolves under the per-principal root; documented behavior |
| `ssh upload` with `inputParams: ['localPath']` and a ready ref | succeeds |
| `ssh download` with `outputParams: ['localPath']` and a reserved ref | succeeds, then `status=ready`, `download` works |
| `ssh download` with a ready ref in the output param | rejected before the call |
| whole-arg credential slot resolves to `--allowed-local-paths=/` | spawn refused / staging disabled (owner-only too) |
| whole-arg credential slot resolves to `--config-file=/tmp/x` | spawn refused / staging disabled (owner-only too) |
| connected ssh server version != 1.11.0 | staging disabled (owner-only too) |
| `execute-command` (remote) | not part of the local boundary; document |

Source-verified for P1-10: 1.11.0's `validateLocalPath(..., 'write')` accepts an existing zero-byte `content` file; `download` writes a unique temp with `wx` and `rename`s it over `localPath`. Keep the "download into a reserved ref destination" test; no source change is needed.

### 11.3 Local filesystem fixture

A test stdio server (or the `filesystem` MCP server) with roots set to the per-principal staging root:

- roots = per-user root; inside succeeds; `../`, absolute outside, symlink outside rejected; directory policy is the fixture's own (the hub adds no global guard);
- owner-only mode with a test-only adapter fixture (production supports `ssh` only; the fixture is not a supported adapter); per-principal root; no `staging.shared`; **no hub-cwd mode**;
- repeat with a second user to prove separation.

### 11.4 Config/auth/download tests

- file + DB mode round-trip of `fileStaging` and `staging`;
- settings sync / dashboard edit does not drop the flag; `tools`/`staging` absent vs explicit `undefined` on update: absent preserves, `undefined` normalizes to absent (never writes null);
- duplicate/template/migration;
- anonymous, bearer-disabled, skipAuth guest, synthetic dashboard, hosted, replica;
- system keys rejected (with/without owner) **before any username fallback**; guest, `:user` mismatch, revoked group, deleted user, `credentialEligible:false`;
- reserved `mcphub_file_*` name with no eligible target/source: rejected without calling `principalRuntimes.acquire`;
- multi-ref output lease: acquire in opposite order, partial-acquire release, finalize failure; no leak/livelock;
- read pin: TTL expiry during a slow `ssh upload` input or download does not delete the file;
- quota reservation at lease: second output lease rejected before upstream;
- file mode: two processes cannot both lease (lockfile/instance id); JSON delete/recreate gets a new server UUID;
- download headers/content disposition/token replay/TTL/hash mismatch/Host/XFH spoof/no base/HEAD/Range;
- activity log has no base64/URL/token/ref/path/filename, including the owner-only upstream rewritten path;
- collision with `mcphub_file_*` upstream name (static + dynamic);
- `$smart` does not list or call virtual tools in PR 1; `$smart call_tool` to a real tool with a staging path is still guarded;
- parallel redemption of a one-time download token: exactly one succeeds;
- **two concurrent calls using the same reserved output ref (deterministic):** block call1 inside the mock upstream with a latch; while call1 holds the lease, start call2; call2 must receive a **lease-conflict** error, not the ready-state error; the mock's call2 invocation count is 0; assert the ledger shows call1's lease at rejection time; exactly one finalize/version; release the latch. Add a negative control that moves lease acquisition after upstream — it must fail. Run in DB and file modes.
- parallel finalize of the same reserved ref: idempotent, one ready/version;
- deleted/recreated/renamed username: no inherited staging root;
- `meta.json` tamper: hub ledger wins, download rejected;
- staged `config.json` in the per-principal root: no extra roots; fake server ignoring cwd/adding a root: staging disabled.

### 11.5 Dispatch/list/cache/ledger tests

- `listGroupTools(includeVirtualTools:false)` for the `$smart` pinned builder and `preserveToolNames` dispatch validation: no virtual tools; ordinary list: virtual tools exactly once.
- Upstream collision: a known or dynamic `mcphub_file_*` name never reaches the upstream tool; the reserved name is rejected, staging is disabled/hidden (fail closed), and static collisions are rejected at config/import.
- When `routeHasStaging`, the list is generated/`ttlMs=0`; a cached response must not hide/show virtual tools after a flag/trust change.
- DB/file ledger parity; crash/restart recovery; parallel finalize/token consume; token cleanup; a missing ledger row never serves a file.
- `file_staging_refs`/`file_staging_tokens` migrations and DAO round-trip; no ref without a ledger row.

### 11.6 Runtime/persistence/config acceptance

- Runtime transitions: staging true→false (shared or owner-only), adapter/package/version/args/credential changes while a child exists, owner→public, disconnect/restart; assert no old-cwd use and no cross-user ref.
- List vs dispatch use the same predicate: group alias/`preserveToolNames`, config fallback keys that shadow another tool, empty personal catalog, revoked visibility/key/group, dynamic collision, cache TTL zero.
- Principal identity: existing DB/file users without id/salt, concurrent first use, delete/recreate, rename; system keys rejected.
- Persistence: refs/token store round-trip/restart/corrupt/partial write, concurrent upload/finalize/download/expire/quota; explicit migrations with `DB_SYNCHRONIZE=false` and `true`.
- Tool state: reserved used as input, ready reused as output, zero-byte, thrown/cancelled call, parallel different servers, target rename/delete/recreate, version/hash mismatch.
- Config APIs: every create/update/import/sync/batch path admin-gates `staging.shared`; tool flag preserved on toggle/description/hiddenParams; safe vs full projection; duplicate/template.
- Real SSH test pins the exact npm artifact/integrity and asserts the installed version; directory output rejected; remote `execute-command` explicitly outside the boundary.

## 12. Threat model and residual risks

| Threat | Mitigation in PR 1 | Residual |
|---|---|---|
| Shared stdio reads all staging | trusted `ssh` adapter, per-principal cwd, no extra roots, boundary tests | same UID/root; tools ignoring cwd; `exec`; **no global path guard**; not OS isolation |
| Owner-only ssh reads hub files/other roots | owner-only ssh also uses adapter + per-principal cwd; no hub-cwd mode; owner-only negative tests | same UID; other local-file/shell tools |
| Cross-tool staging read | **none added in PR1** (maintainer kept the global heuristic guard out) | any other local-file/shell stdio server can read the staging tree; documented; admin must restrict/accept |
| Username/filename traversal into staging/MCPB | principal hash, UUID, fixed `content`, display-only filename, `O_NOFOLLOW`, containment for staging paths | other local-file/shell tools can read MCPB/settings; same UID; TOCTOU |
| Ref theft/confused deputy | owner + server binding, generic 404; toolName audit | malicious tool on the same server can read files it is given |
| Download XSS | octet-stream + attachment + nosniff + CSP sandbox + no-store; fd/hash | dashboard origin compromise |
| Token theft/logging | opaque, hash at rest, one-time, TTL, no logs, trusted base URL | proxy/admin logs; one-time retry UX |
| Activity log content | metadata-only for virtual tools; rewritten upstream calls use explicit `suppressPayload`/redaction | upstream tool payloads still governed by existing config |
| Disk/quota exhaustion | per-user/global caps, 507, TTL; quota reserved at lease and checked at finalize | **not a hard boundary** against a misbehaving child; same volume as settings |
| `meta.json` tampering | authoritative hub state/DB ledger; sidecar is a cache; cross-check at finalize/download | same-UID tool can write the sidecar; hub state is the source of truth |
| Hosted/replica | disabled/fail closed | future multi-node design |
| Collision/impersonation | reserved `mcphub_file_*` namespace, validation, staging fail-closed on dynamic collision | dynamic catalog collision |
| Host header | configured base URL required | misconfiguration |
| stdio mismatch | normalized type + no url at save/runtime | legacy configs; startup validation |
| Public/group operator | warning + trusted adapter + tests | operator can read; not preventable in-process |

## 13. PR plan

### PR 1 (backend/API, no UI, no `$smart`, no browser upload)

1. Config/types/persistence: `fileStaging`, `staging` (owner-only adapter included), settings sync, dashboard payload, DB `staging`/`fileStaging` columns, `file_staging_refs`/`file_staging_tokens` tables (DB) / state store (file mode), random server UUIDs, file-mode lockfile/instance id, template/migration/DAO/replica inventory, explicit `DB_SYNCHRONIZE=false` migrations, API validation.
2. Principal resolver + auth rejects (system keys rejected before username fallback); hosted/replica fail closed; stable principal id/salt migration/backfill for DB and file users.
3. Storage/refs/state/quota/TTL/cleanup; per-principal root; **no global path guard** (cross-tool risk documented); authoritative hub state; exclusive multi-ref output lease acquired before upstream; no runtime lease TTL; startup leased-`reserved` -> failed; read pins; quota reservation at lease; token store; file-mode lock.
4. Hub-tool dispatcher with collision-safe `resolveHubStagingTool`; **reserved `mcphub_file_*` fails closed before any wrapper/runtime acquisition**; `getStagingTargets`; `includeVirtualTools` list injection for non-`$smart`; cache TTL zero; runtime invalidation/connection fingerprint and per-user child `cwd` plumbing; one rewrite/lease/finalize helper in `callToolWithReconnect` covering regular and `$smart call_tool`.
5. Tools `upload`/`status`/`download`; `inputParams`/`outputParams` enforcement (ready vs reserved, undeclared refs rejected); `allow_zero_byte`; reserve finalize in `try/finally`; ref rewrite only in declared params.
6. Download endpoint/token/headers/basePath/limiter.
7. Activity/metrics metadata-only + explicit `suppressPayload` for rewritten calls.
8. Tests: unit, local fixture (always-on gate), real `ssh` disposable suite (acceptance blocker), config/auth/download/negative; typecheck with scoped tsconfig. Propose a dedicated CI job in the PR1 description; do not make it a required workflow until the maintainer agrees — attach contributor-run logs if CI is unavailable.
9. Docs: limitations, trusted adapter, base URL, single-instance, no OS isolation, and the **explicit cross-tool risk** from other local-file/shell servers.

### PR 2 (browser + UI)

- token upload endpoint + standalone page; `mcphub_file_request_upload`;
- server-level "Allow shared staging" UI, per-tool enable + input/output param selectors, Settings limits, i18n;
- docs.

### PR 3 (later)

- `$smart` direct/nested call/describe + `search_tools`;
- `filesystem` adapter and/or per-server root template;
- response detection / S3 / multi-node / OS-level isolation (only with a new design).

### PR 1 acceptance

- owner-only and shared `ssh` end-to-end: upload/reserve → tool use → status → download;
- owner-only A cannot read `/app/mcp_settings.json` or `/app/data/uploads/staging/<userB-hash>/...` (per-principal root, no hub-cwd mode);
- all §11 ssh-root and ref-parameter negative tests pass; hub-global path-guard tests are **deferred** with the guard;
- input/output param enforcement: ready-only inputs, reserved-only outputs, undeclared refs rejected, finalize exactly output refs, pre-call exclusive output lease (deterministic two-call test: one upstream);
- multi-ref lease acquire/release; read pin during slow input/download; quota reserved at lease;
- no upstream runtime acquisition on virtual calls or reserved-name rejection (test);
- config round-trips in file+DB mode;
- anonymous/skipAuth/synthetic/hosted/replica rejected;
- no base64/URL/token/path in activity logs, including the owner-only upstream rewritten path;
- `$smart` unchanged;
- cross-tool risk documented in the docs/ADR and release note;
- code review + `pnpm backend:build`/tests.

CI story: unit/config/guard/local-fixture tests run in `pnpm test:ci` (always-on gate). The real `ssh` suite is an acceptance blocker and runs against a disposable instance with `@fangjunjie/ssh-mcp-server@1.11.0`; PR 1's description proposes a dedicated CI job, but it is **not a required workflow** until the maintainer agrees (fork PR workflows need approval). If CI cannot run it, attach contributor-run logs/artifacts; a skipped suite is not a silent pass.

Backward compatibility: everything is opt-in; the master switch defaults to false; existing configs are unchanged; no behavior changes unless `staging.shared` or `fileStaging` is set.

Docs: feature docs (placement decided with the maintainer), curl examples for the UI-less PR 1 API, release note, and a one-line security note for this security-sensitive feature.

## 14. Open questions (resolve before implementation)

1. Resolved for `@fangjunjie/ssh-mcp-server@1.11.0`: `--allowed-local-paths` / `--config-file` disable staging (shared or owner-only); with neither, the per-principal cwd is the only root. The **resolved** argv is checked per principal (credential-template args slots can inject flags), and the connected server version must be 1.11.0. Revalidate on package/version/flag change; if a deployment uses a config file or extra roots, staging stays disabled.
2. Whether the per-server trust should be `staging.shared` + adapter, or a separate admin trust registry; this design uses per-server.
3. Global config DB shape: new `simple-json` column vs namespace in an existing JSON column; this design assumes an additive column.
4. `server` parameter vs inferring the single target; this design uses optional `server` with required-when-multiple.
5. Whether `request_upload` should be PR 1 or PR 2; this design puts it in PR 2.
6. Docs PR #1471 (`docs/adr/0006-file-staging.md`) is updated with the P0/P1 revisions; wait for the author's re-review before PR1.
7. Input vs output params: `fileStaging { enabled, inputParams, outputParams }`; the ADR records the object shape; no further confirmation needed unless the maintainer objects.
8. Global heuristic path guard is **out of PR1**; the cross-tool risk is documented; a scoped guard/isolation can be PR3.
9. Template export intentionally excludes `staging` trust; import revalidates; recorded in the ADR.
10. OAuth write scopes are not enforced in PR1 (token scopes are discarded); documented residual.
11. Real SSH CI job placement: propose it in PR1's description; do not make it a required workflow until the maintainer agrees.
12. `ssh download` into a pre-created zero-byte reserved `content` is source-verified against 1.11.0: `validateLocalPath(...,'write')` accepts the existing file, writes a unique temp with `wx`, and `rename`s over it. Add the test; no design change.

## 15. Code anchors

- wrapper chain: `src/services/mcpService.ts:6115-6122`, `:6283-6284`;
- principal acquisition: `:5871-5908`, `:5942-5958`, `:5917-5924`;
- modern lists: `:5755-5818`;
- policy: `:6153-6185`;
- list: `:4242-4309`; scoped servers `:6370-6415`; group filter `:6431-6457`; config filter `:3248-3263`;
- list callers/collision/cache: `:4352-4367`, `:4107-4113`, `:4030-4049`, `:4520-4529`, `:6086-6099`;
- credential template: `src/utils/credentialTemplate.ts:7-18`, `:32-35`; `src/services/mcpService.ts:1916`, `:5675`;
- tool config: `src/utils/toolConfig.ts:20-48`;
- child cwd: `src/services/mcpService.ts:1911-1920`;
- call/rewrite: `:1992-2015`, `:4764-4776`, `:4985-4994`;
- policy wrapper/hosted: `:6119-6265`;
- config: `src/types/index.ts:499-524`; `src/dao/ServerDao.ts:79-82`; `src/dao/ServerDaoDbImpl.ts:256-260`; `src/db/entities/Server.ts:71-78`; `src/utils/settingsSync.ts:60-87`; `frontend/src/utils/serverFormPayload.ts:245-314`; `src/controllers/serverController.ts:1336-1358`;
- global config: `src/controllers/serverController.ts:2074-2099`, `:2261-2282`; `src/db/entities/SystemConfig.ts:7-55`; `src/dao/SystemConfigDaoDbImpl.ts:16-84`;
- tool projection: `src/services/mcpService.ts:768-778`, `:3035-3052`; `frontend/src/types/index.ts:118-128`;
- auth: `src/services/sseService.ts:438-467`, `:540-577`, `:1022-1029`; `src/middlewares/auth.ts:90-92`; `src/server.ts:180-214`;
- JSON limit: `src/utils/bearerAuth.ts:7-17`; `src/middlewares/index.ts:36-64`;
- base URL: `src/utils/installBaseUrl.ts:5,17-25`; `src/utils/protectedResource.ts:8-16` is the Host-fallback helper — do not use it for staging links;
- activity: `src/services/activityLoggingService.ts:110-112`;
- mcpb path: `src/routes/index.ts:451-462`; `src/controllers/mcpbController.ts:20-38`.
