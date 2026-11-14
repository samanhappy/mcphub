# File staging for stdio servers: trusted shared profile and explicit file parameters

Status: proposed. The scope, trusted-profile direction, PR split, no-global-path-guard decision, and per-tool permission split were agreed with the maintainer in [#1056](https://github.com/samanhappy/mcphub/issues/1056) on 2026-11-10. The per-tool input/output parameter model below is the proposal that settles the remaining question. Revised 2026-11-11 after an independent security/spec review: owner-only staging now requires the same adapter and per-principal root; lease lifetime/startup recovery, multi-ref atomicity, read pins, quota reservation, and reserved-name fail-closed behavior are specified. Implementation follows after this design is settled.

## Context

A stdio MCP server hosted behind MCPHub receives local path arguments from a remote client. The path is forwarded to the child process and resolves inside the MCPHub host/container, not on the client machine. A `filesystem` server behind the hub is therefore unusable for client-local files, and the same applies to `ssh`-style servers whose local transfer commands run on the hub.

The MCP protocol has no file-transfer primitive. The relevant TUS proposal was closed, elicitation schemas are flat primitives, and MCP Apps has no standard file API. Workarounds (local stdio per client, static volume mounts, object-storage MCP servers) do not cover the "upload → process → retrieve" workflow.

The maintainer agreed to explore an opt-in staging layer for shared SSH, with an explicit boundary:

> Shared/public staging should require a trusted server configuration that enforces each user's staging root; credentialTemplate and cwd alone are not sufficient.

The maintainer also asked to keep the global heuristic path guard out of the first PR because it would affect unrelated stdio tools, to document the risk from those tools, and to clarify how input versus output parameters are identified so reserved/ready ref rules can be enforced. This ADR records those decisions.

## Decision

### 1. Scope and PR split

- **PR1 (backend/API only):** owner-only staging and shared staging through a trusted `ssh` server; three MCP tools (`mcphub_file_upload`, `mcphub_file_status`, `mcphub_file_download`); exact `mcpfile://<uuid>` request rewrite; storage, refs, auth, download, limits, and negative tests.
- **PR2:** browser upload endpoint/page, `mcphub_file_request_upload`, server/tool/settings UI, i18n.
- **PR3 (later):** `$smart` listing/call/describe, `filesystem` adapter, optional scoped path guard or OS isolation, S3/multi-node only with a new design.

Out of scope for PR1: response-path detection, S3/MinIO, multi-node, replica/hosted staging, directory refs, OS-level isolation, and any claim of transparent access to the client filesystem.

### 2. Trusted shared profile

Shared staging is a server-level, admin-only declaration:

```ts
interface ServerStagingConfig {
  shared: boolean;
  adapter: 'ssh';
}

interface ServerConfig {
  staging?: ServerStagingConfig;
}
```

A server is **owner-only** when it is private, has no `sharedWithUsers`/`sharedWithUserGroups`, and the per-tool `fileStaging` object is enabled. Owner-only staging does **not** require `staging.shared`, but it still requires `staging.adapter: 'ssh'`, the same pinned-profile/argv validation, and a per-principal root; there is no hub-cwd staging mode. Non-ssh owner-only staging is not supported in PR1. A private-but-shared, group, or public server requires `staging.shared` and a validated adapter; otherwise staging is hidden on shared routes. Never treat `credentialTemplate` plus a per-user cwd as sufficient for shared staging.

The PR1 adapter validates the pinned SSH profile:

- `@fangjunjie/ssh-mcp-server@1.11.0`, with the version pinned in args;
- no `--allowed-local-paths` and no `--config-file` (a config file could carry `allowedLocalPaths`);
- the per-principal child `cwd` is exactly `<stagingRoot>/<principalHash>`;
- the server's own `getAllowedLocalRoots()` is `[cwd, ...extra]`; no extra roots are allowed;
- the **resolved** argv is checked per principal after credential-template substitution, using a strict SSH option allowlist, so an args slot cannot inject `--allowed-local-paths=/` or `--config-file`;
- after connect, `serverInfo.version === '1.11.0'` is required;
- if the version, flags, or roots cannot be verified, staging stays disabled (shared or owner-only); there is no hub-cwd fallback.

The adapter is a named contract (`validateServerConfig`, `validateResolvedArgs`, `prepareRuntime`, `getStagingRoot`), not a generic checkbox. The SSH server's `validateLocalPath` resolves and `realpath`s local paths and rejects paths outside the per-user root, including `..`, outside absolute paths, and symlinks that escape the root.

The reserved `mcphub_file_*` namespace fails closed: if no eligible staging target or MCP caller is found, the call is rejected **before** the tool-policy/principal/modern-list wrappers, without acquiring an upstream runtime. Upstream tools may not claim the namespace: a known static collision is rejected at config/import, and a dynamic collision disables staging and the reserved name is rejected, never forwarded. The rewrite/lease/finalize helper lives in `callToolWithReconnect` (after hidden-argument removal), so regular calls and `$smart call_tool` to a real staging tool share one interception point; virtual tools remain direct-only.

Any SSH staging (shared or owner-only) changes the child `cwd` for **every** tool on that server, so relative local paths resolve under the per-principal root. There is no hub-cwd staging mode. The maintainer accepted the shared-server cwd change as an explicit admin opt-in on 2026-11-10; the owner-only owner is the only user on that server. Any staging, visibility, type, credential, package, version, or args change must invalidate the principal runtime and revalidate before rewrite/finalize; a downgrade fails closed.

### 3. No global heuristic path guard in PR1

The maintainer asked to keep the global heuristic path guard out of PR1 because it would reject or alter unrelated stdio tool arguments. PR1 therefore:

- does not scan unrelated stdio arguments and does not reject raw absolute paths at the hub;
- rewrites only exact `mcpfile://<uuid>` values in the tool's declared file parameters;
- relies on the SSH server's own per-user root as the boundary for **both** shared and owner-only staging;
- there is no owner-only hub-cwd fallback: owner-only SSH uses the owner's per-principal root and the same adapter validation.

**Documented risk:** another stdio server with local-file or shell access in the same deployment can read the staging tree. All stdio children share the OS user/root by default. The hub does not guard those tools. Admins must restrict/remove them or accept the risk. There is no OS isolation. This is a residual, not a claim of safety. A future PR can add a scoped/opt-in guard or isolation.

### 4. Input vs output parameters

Per-tool configuration is an object, not a boolean:

```ts
interface ToolFileStagingConfig {
  enabled: boolean;
  inputParams?: string[];  // ready refs only
  outputParams?: string[]; // reserved refs only
}
```

- `inputParams`/`outputParams` are JSON Schema property names (top-level) or dot paths for nested objects. They must exist, be string-typed, not overlap, and at least one must be present when `enabled` is true.
- A tool with `enabled: true` but no file params is rejected at config validation.
- A `ready` ref is allowed only in `inputParams`; a `reserved` ref is allowed only in `outputParams`. A `reserved` ref in an input, a `ready` ref in an output, or the same ref in both is rejected before the upstream call.
- A `mcpfile://` value in an undeclared parameter is rejected, not rewritten.
- **Before rewriting output arguments and calling upstream, acquire an exclusive lease on every reserved output ref in the call, atomically.** Acquire the full set with one conditional update/lock, release partial acquisitions in `finally`, and do not hold a DB transaction across the upstream call. If any ref is already leased, reject the whole call before upstream; the competing call must not reach the tool. Hold all output leases through finalization and release them on success, failure, or cancellation. A finalizer-only CAS is insufficient: without a pre-call lease, two calls can both write the same reserved destination and only discover the conflict after upstream.
- **Lease lifetime (single-process PR1):** leases do not expire while the hub process is alive; `lease_until` is a crash/diagnostic backstop, not a runtime TTL. A second call cannot acquire a ref whose `lease_id` is set, regardless of `lease_until`. On startup every leased `reserved` ref becomes `failed` (terminal), its lease is cleared, and its UUID is never reused. A lockfile/instance id prevents a second process from running staging; multi-process mode would need heartbeat + confirmed-dead takeover.
- **Read pins:** ready inputs and downloads take a read pin (`pin_count`/`pin_until`); cleanup skips pinned refs; release in `finally`. Do not reuse the exclusive output lease for reads.
- **Quota at lease:** reserve `maxFileBytes`/quota when the output lease is acquired, check `statfs` before upstream, and cap concurrent leased outputs; reject 507/429 before the child writes. Adjust at finalize.
- After the call, finalize exactly the reserved refs passed in `outputParams`, in a `try/finally`; finalize and release in one conditional update (`WHERE ref=:ref AND lease_id=:call`), check one row; only the lease holder may finalize; a thrown/cancelled call marks them failed and releases their leases. Zero-byte outputs require `allow_zero_byte: true`.
- Examples: `ssh upload` declares `inputParams: ['localPath']` (the local source is read); `ssh download` declares `outputParams: ['localPath']` (the local destination is reserved). `remotePath` is not a staging parameter.

`mcphub_file_upload` with small inline content creates a `ready` ref; without content it creates a zero-byte `reserved` output destination. `mcphub_file_status` reports state/size/hash/expiry; `mcphub_file_download` returns a short-lived one-time URL only for a `ready` registered ref. `mcphub_file_request_upload` ships with the PR2 browser page.

### 5. Storage, refs, auth, and download

- Storage root: `<process.cwd()>/data/uploads/staging/<principalHash>/<uuid>/{content,meta.json}`; UUID refs; fixed `content`; original filename display-only; `0700`/`0600`; `O_NOFOLLOW`; parent components checked; no symlinked parents; `nlink === 1` for tool-produced files.
- Principal hash requires a stable user id or a per-user salt. Do not derive it from the username alone; a deleted/recreated/renamed user must not inherit the old root. System keys are rejected for staging in PR1.
- Refs are owner/server-bound; `serverId` is a stable random UUID (including file mode), never name-derived; toolName is recorded for audit but not enforced as a binding. Foreign/expired refs return the same 404.
- Authoritative ref state is hub-side (DB `file_staging_refs`/`file_staging_tokens` tables in DB mode; a locked atomic state store in file mode). `meta.json` is a cache. The ledger carries `lease_id`, `lease_until`, `pin_count`, `pin_until`, and `allow_zero_byte`; tokens bind the ready `version`/`content_hash`.
- Output refs use an exclusive lease acquired **before** argument rewrite and upstream call, held through finalization; only the lease holder may finalize. On startup every leased `reserved` row becomes `failed` and its UUID is never reused; read pins protect ready inputs/downloads from cleanup. File mode uses a lockfile/instance id and refuses staging if a second process holds it.
- Download uses `application/octet-stream` + `Content-Disposition: attachment`, `nosniff`, CSP sandbox, no-store, no-referrer; configured base URL only (no `Host` fallback); `O_NOFOLLOW`/parent checks/hash check (streaming verify or capped prehash); `HEAD` does not consume the token; no range/inline.
- No heuristic response rewriting. Activity logs for virtual/rewritten calls are metadata-only (`suppressPayload`), including owner-only rewritten paths.
- Template export intentionally excludes `staging` trust; import revalidates it. This prevents a template/duplicate from silently granting staging trust.

### 6. Tests

Acceptance blockers, run against a disposable instance and the pinned SSH artifact:

- SSH server root: `upload('/app')`, `upload('/app/data')`, outside `<stagingBase>`, `..`, symlinked outside, another user's root → rejected by the SSH server; owner-only A cannot read `/app/mcp_settings.json` or `/app/data/uploads/staging/<userB-hash>/...`; own root/directory behavior documented.
- Credential-slot injection: a whole-arg slot resolving to `--allowed-local-paths=/` or `--config-file=/tmp/x` → spawn refused / staging disabled (owner-only too); connected version ≠ 1.11.0 → staging disabled.
- Input/output: ready ref in input succeeds; reserved ref in output succeeds and finalizes; reserved in input, ready in output, same ref in both, undeclared ref, missing/overlapping/nonexistent params → rejected; `upload(server=<non-staging>)`, master-switch-off, and hidden-param overlap are rejected.
- Reserved namespace: a static upstream `mcphub_file_*` collision is rejected at config/import; a dynamic collision disables staging; the reserved call is never forwarded to the upstream tool.
- **Two concurrent calls using the same reserved output ref (deterministic):** block call1 in the mock upstream with a latch; call2 must get a lease-conflict error (not the ready-state error), its upstream invocation count must be 0, and the ledger must show call1's lease; exactly one finalize/version. A negative control that moves lease acquisition after upstream must fail. Run in DB and file modes.
- Multi-ref lease (opposite order, partial-acquire release, finalize failure); read pin during a slow input/download; quota reservation at lease; system key rejection before username fallback; file-mode two-process lock.
- Cross-principal ref; foreign ref; reserved/partial download; hash mismatch; hardlink; quota; TTL/lease; crash/restart.
- Owner-only/shared/group/public visibility; system keys rejected; deleted/recreated/renamed user; config round-trip and invalidations.
- **Documented, not blocked:** another local-file/shell tool reading `/app/data/uploads/staging`; this is the accepted PR1 residual.
- **Real SSH CI:** the disposable suite is an acceptance blocker; PR1 proposes a dedicated job, but it is not a required workflow until the maintainer agrees. The local fixture is the always-on gate.

### 7. Consequences

Positive: the shared SSH use case becomes usable without giving the client transparent filesystem access; downloads are limited to registered, ready refs; the trusted profile and negative tests are reviewable before code.

Residuals: no OS isolation; other local-file/shell tools can read staging; any SSH staging changes relative paths for all tools on that server (admin/owner opt-in); owner-only SSH now requires the adapter/per-principal root and non-ssh owner-only staging is unsupported in PR1; `$smart`, browser upload/UI, filesystem adapter, S3/multi-node, and response detection are later work; OAuth write scopes are not enforced in PR1 (token scopes are currently discarded) and this is documented. The real-SSH CI job is a proposal pending maintainer approval, not a required workflow in this PR.

## Alternatives considered

- **Global heuristic path guard in PR1:** deferred at the maintainer's request; it would affect unrelated stdio tools and needs a compatibility design.
- **Per-ref direction only (`?mode=in|out`):** cannot identify which parameter is input vs output, so reserved/ready rules cannot be enforced.
- **Boolean `fileStaging`:** cannot distinguish input from output params; rejected in favor of the object above.
- **Automatic response-path detection / S3:** out of scope; no reliable generic rule and no multi-node design.

## References

- Issue [#1056](https://github.com/samanhappy/mcphub/issues/1056).
- Full Phase 1 implementation design: https://gist.github.com/SAXEM1997/496514b20db29a7524894df121018de6
