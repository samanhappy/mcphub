# File staging for stdio servers: trusted shared profile and explicit file parameters

Status: proposed. The scope, trusted-profile direction, PR split, no-global-path-guard decision, and per-tool permission split were agreed with the maintainer in [#1056](https://github.com/samanhappy/mcphub/issues/1056) on 2026-11-10. The per-tool input/output parameter model below is the proposal that settles the remaining question. Revised 2026-11-11 with the pre-call exclusive output lease requested in the PR review. Implementation follows after this design is settled.

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

A server is **owner-only** when it is private, has no `sharedWithUsers`/`sharedWithUserGroups`, and the per-tool `fileStaging` object is enabled. A private-but-shared, group, or public server requires `staging.shared` and a validated adapter; otherwise staging is hidden on shared routes. Never treat `credentialTemplate` plus a per-user cwd as sufficient.

The PR1 adapter validates the pinned SSH profile:

- `@fangjunjie/ssh-mcp-server@1.11.0`, with the version pinned in args;
- no `--allowed-local-paths` and no `--config-file` (a config file could carry `allowedLocalPaths`);
- the per-principal child `cwd` is exactly `<stagingRoot>/<principalHash>`;
- the server's own `getAllowedLocalRoots()` is `[cwd, ...extra]`; no extra roots are allowed;
- the **resolved** argv is checked per principal after credential-template substitution, using a strict SSH option allowlist, so an args slot cannot inject `--allowed-local-paths=/` or `--config-file`;
- after connect, `serverInfo.version === '1.11.0'` is required;
- if the version, flags, or roots cannot be verified, shared staging stays disabled. Owner-only staging remains available.

The adapter is a named contract (`validateServerConfig`, `prepareRuntime`, `getStagingRoot`), not a generic checkbox. The SSH server's `validateLocalPath` resolves and `realpath`s local paths and rejects paths outside the per-user root, including `..`, outside absolute paths, and symlinks that escape the root.

A shared server's child `cwd` changes for **every** tool on that server, so relative local paths resolve under the per-user root. This is an explicit admin opt-in; the maintainer accepted it on 2026-11-10. Any staging, visibility, type, credential, package, version, or args change must invalidate the principal runtime and revalidate before rewrite/finalize; a downgrade fails closed.

### 3. No global heuristic path guard in PR1

The maintainer asked to keep the global heuristic path guard out of PR1 because it would reject or alter unrelated stdio tool arguments. PR1 therefore:

- does not scan unrelated stdio arguments and does not reject raw absolute paths at the hub;
- rewrites only exact `mcpfile://<uuid>` values in the tool's declared file parameters;
- relies on the SSH server's own per-user root as the shared boundary;
- for owner-only SSH staging, the SSH server's cwd is the hub cwd and the same server-side check applies.

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
- **Before rewriting output arguments and calling upstream, acquire an exclusive lease on every reserved output ref in the call, atomically.** If any ref is already leased, reject the whole call before upstream; the competing call must not reach the tool. Hold all output leases through finalization and release them on success, failure, or cancellation. A finalizer-only CAS is insufficient: without a pre-call lease, two calls can both write the same reserved destination and only discover the conflict after upstream.
- After the call, finalize exactly the reserved refs passed in `outputParams`, in a `try/finally`; only the lease holder may finalize; a thrown/cancelled call marks them failed and releases their leases. Zero-byte outputs require `allow_zero_byte: true`.
- Examples: `ssh upload` declares `inputParams: ['localPath']` (the local source is read); `ssh download` declares `outputParams: ['localPath']` (the local destination is reserved). `remotePath` is not a staging parameter.

`mcphub_file_upload` with small inline content creates a `ready` ref; without content it creates a zero-byte `reserved` output destination. `mcphub_file_status` reports state/size/hash/expiry; `mcphub_file_download` returns a short-lived one-time URL only for a `ready` registered ref. `mcphub_file_request_upload` ships with the PR2 browser page.

### 5. Storage, refs, auth, and download

- Storage root: `<process.cwd()>/data/uploads/staging/<principalHash>/<uuid>/{content,meta.json}`; UUID refs; fixed `content`; original filename display-only; `0700`/`0600`; `O_NOFOLLOW`; parent components checked; no symlinked parents; `nlink === 1` for tool-produced files.
- Principal hash requires a stable user id or a per-user salt. Do not derive it from the username alone; a deleted/recreated/renamed user must not inherit the old root. System keys are rejected for staging in PR1.
- Refs are owner/server-bound; toolName is recorded for audit but not enforced as a binding. Foreign/expired refs return the same 404.
- Authoritative ref state is hub-side (DB `file_staging_refs`/`file_staging_tokens` tables in DB mode; a locked atomic state store in file mode). `meta.json` is a cache. Output refs use an exclusive lease acquired **before** argument rewrite and upstream call, held through finalization; only the lease holder may finalize. One-time download token consumed atomically; no serving without a ledger row.
- Download uses `application/octet-stream` + `Content-Disposition: attachment`, `nosniff`, CSP sandbox, no-store, no-referrer; configured base URL only (no `Host` fallback); `O_NOFOLLOW`/parent checks/hash check; no range/inline.
- No heuristic response rewriting. Activity logs for virtual/rewritten calls are metadata-only (`suppressPayload`), including owner-only rewritten paths.

### 6. Tests

Acceptance blockers, run against a disposable instance and the pinned SSH artifact:

- SSH server root: `upload('/app')`, `upload('/app/data')`, outside `<stagingBase>`, `..`, symlinked outside, another user's root → rejected by the SSH server; own root/directory behavior documented.
- Credential-slot injection: a whole-arg slot resolving to `--allowed-local-paths=/` or `--config-file=/tmp/x` → spawn refused/shared disabled; connected version ≠ 1.11.0 → shared disabled.
- Input/output: ready ref in input succeeds; reserved ref in output succeeds and finalizes; reserved in input, ready in output, same ref in both, undeclared ref, missing/overlapping/nonexistent params → rejected.
- **Two concurrent calls using the same reserved output ref: exactly one acquires the pre-call lease and reaches upstream; the other is rejected before upstream; no double write; finalize only by the lease holder.**
- Cross-principal ref; foreign ref; reserved/partial download; hash mismatch; hardlink; quota; TTL/lease; crash/restart.
- Owner-only/shared/group/public visibility; system keys rejected; deleted/recreated/renamed user; config round-trip and invalidations.
- **Documented, not blocked:** another local-file/shell tool reading `/app/data/uploads/staging`; this is the accepted PR1 residual.

### 7. Consequences

Positive: the shared SSH use case becomes usable without giving the client transparent filesystem access; downloads are limited to registered, ready refs; the trusted profile and negative tests are reviewable before code.

Residuals: no OS isolation; other local-file/shell tools can read staging; the shared child cwd changes relative paths for all tools on that server (admin opt-in); `$smart`, browser upload/UI, filesystem adapter, S3/multi-node, and response detection are later work; OAuth write scopes are not enforced in PR1 (token scopes are currently discarded) and this is documented.

## Alternatives considered

- **Global heuristic path guard in PR1:** deferred at the maintainer's request; it would affect unrelated stdio tools and needs a compatibility design.
- **Per-ref direction only (`?mode=in|out`):** cannot identify which parameter is input vs output, so reserved/ready rules cannot be enforced.
- **Boolean `fileStaging`:** cannot distinguish input from output params; rejected in favor of the object above.
- **Automatic response-path detection / S3:** out of scope; no reliable generic rule and no multi-node design.

## References

- Issue [#1056](https://github.com/samanhappy/mcphub/issues/1056).
- Full Phase 1 implementation design: https://gist.github.com/SAXEM1997/496514b20db29a7524894df121018de6
