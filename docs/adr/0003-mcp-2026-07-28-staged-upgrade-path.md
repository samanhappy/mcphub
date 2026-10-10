# Adopt MCP 2026-07-28 through a staged upgrade path

MCPHub adopts the MCP `2026-07-28` specification (stateless core: no `initialize` handshake, no `Mcp-Session-Id`) in three decoupled steps instead of a single migration:

1. **OAuth hardening on the current SDK** (no wire change): add RFC 9207 `iss` to our authorization server's authorize responses (`oauthServerController.ts` builds redirects with only `code`/`state` today) and validate `iss` when redeeming codes as an upstream OAuth client; add Client ID Metadata Documents (CIMD) alongside Dynamic Client Registration — DCR is formally deprecated in the new revision but keeps working.
2. **SDK v2 API migration, wire unchanged**: move from the monolithic `@modelcontextprotocol/sdk` (v1, negotiating `2025-11-25`) to the v2 split packages (`@modelcontextprotocol/server`, `/client`, HTTP adapters), using the official codemod. Servers keep speaking `2025-11-25` until step 3.
3. **Protocol enablement via dual-stack handler**: serve both revisions from one endpoint with v2's `createMcpHandler`, run a deprecation window on the legacy SSE transport, then remove the session layer.

The path's shape comes from what the code actually binds to sessions. Most downstream state is derivable: the `enableSessionRebuild` mechanism already reconstructs full sessions from `(sessionId, group)` alone, per-session `Server` instances (`mcpService.ts`) are pure functions of group, and bearer auth is revalidated on every request. Two pieces are genuinely sticky and block step 3: `perSessionClient` upstream isolation plus OpenAPI per-session cookie jars (need an explicit-handle or header-correlation redesign), and the legacy SSE `/messages` endpoint whose group lives only in the session (dies with the transport). We use no sampling/elicitation/roots anywhere, so Multi Round-Trip Requests require zero migration.

## Considered Options

- **Big-bang move to v2 + new protocol now** — rejected: v2 GA'd weeks ago; bundling the transport/session rewrite (~700 lines of session tests plus integration tests encoding session-continuity semantics) with independently valuable OAuth fixes maximizes risk on both.
- **Stay on `2025-11-25` indefinitely** — rejected: the stateless core targets exactly gateway deployments like ours; staying means keeping the session-rebuild workaround layer forever and forgoing header-based routing (`Mcp-Method`/`Mcp-Name`) and list-cache (`ttlMs`/`cacheScope`) passthrough.
- **Gate all work on client ecosystem readiness** — rejected as a blocker: `createMcpHandler` answers both revisions from one endpoint, so old clients keep working throughout; the only real gate is letting early v2 patch releases prove stable before step 2.

## Consequences

- Step 2 drops Node 18 from the support matrix (v2 is ESM-first with CommonJS builds, Node 20+): require Node 20+ in `engines` and documentation, test Node 20/22 in CI, and retain the existing Node 22 Docker runtime.
- The legacy HTTP+SSE transport carries a ≥12-month deprecation window per spec policy; its removal deletes only SSE-specific routing and message dispatch. Shared session-rebuild machinery remains necessary for legacy Streamable HTTP.
- `perSessionClient` isolation must gain an explicit design (tool-minted handles passed as arguments, per the spec's recommended pattern, or a header correlation key) before the session layer can be deleted.
- During the dual-stack period, the group-resolution fallback chain must preserve the GHSA-454m-4vm6-842f scope-validation behavior for requests arriving under either revision.
- Session-continuity tests (cached-session-id reuse after rebuild, initialize-gated session creation) are rewritten at step 3, not patched beforehand.

## Step 2 compatibility boundary

- SDK v2 uses the legacy handshake and the existing protocol preference list, starting with `2025-11-25`. Modern discovery and stateless routing remain deferred to step 3.
- `@modelcontextprotocol/server-legacy` preserves the SSE server transport and OAuth authorization-server helpers. It does not depend on the v1 monolithic SDK.
- Upstream list methods retain single-page discovery, including output-schema validation, instead of adopting v2's automatic pagination. The resilient validator still tolerates uncompilable upstream schemas.
- Session rebuild still restores the Node transport's internal web-standard session state. Real v1-client integration tests cover that private SDK dependency; check them when updating SDK versions.
- The v1 SDK is retained only under a development dependency alias for independent compatibility tests. Google GenAI's unused optional v1 SDK peer is excluded from production dependencies; MCPHub uses GenAI for embeddings, not its MCP integration.

## Explicit state during the dual-stack period

Modern stateful tool calls prefer the MCPHub extension `X-MCPHub-State-Id` (a client-generated UUID v4). When that header is absent, an authenticated OpenAI tool call may instead use its client-declared `_meta["openai/session"]` conversation hint; MCPHub hashes the hint before using it as a state handle. An explicitly supplied but invalid `X-MCPHub-State-Id` never falls back. In either case, the gateway binds state to the authenticated bearer credential, user and route, without creating a downstream MCP transport session. Client metadata is correlation only and never grants access. Legacy requests retain their session-based lifecycle.

The existing isolated upstream clients and OpenAPI cookie jars use this application state key. Active calls hold a lease; idle state expires after 30 minutes and the process admits at most 1,000 modern state scopes. Cleanup closes isolated upstream connections and clears the tracked cookie jars, including clients in principal runtimes. State is process-local; replicas require sticky routing and expiry/restart requires rebuilding application state.

This change covers state ownership and lifecycle only. Legacy SSE/session deprecation remains separate work under #1220.

## Routing headers during the dual-stack period

Modern requests retain their `Mcp-Method` and `Mcp-Name` headers through the Node
adapter. SDK v2's `createMcpHandler` validates required headers, method/name
agreement with the body, and encoded names before dispatch. MCPHub does not
maintain a separate header router: URL group resolution and bearer authorization
remain authoritative. Real HTTP integration coverage exercises global, group and
server routes, invalid headers, bearer rejection and absence of downstream
sessions; existing modern explicit-state and v1-client tests cover both lifecycles.

## Cache hints during the dual-stack period

Modern lists advertise private freshness bounded by every participating upstream's
original discovery expiry and a five-second gateway projection window. Unknown
provenance, partial discovery, built-in content, Smart Routing entries and unknown
hosted permission freshness remain zero. Projection inputs are rebuilt for every
request and changes during the build force zero. See
[ADR-0004](0004-positive-list-cache-hints.md) for the rules and client-staleness
boundary; server invalidation cannot retract already-issued client caches.

Modern `resources/read` forwards a valid upstream TTL after subtracting time
spent handling the read, and restricts the scope to `private`. Missing or invalid
TTLs, built-in resources and gateway-generated error results use zero. Modern
reads bypass the SDK response cache so a cached body cannot be reissued with its
original TTL. Contents and unrelated metadata remain intact, including on MCP
Apps routes. Legacy handlers retain their existing response shape and read path.

These fields are client freshness hints; this change does not add a gateway
response cache or promise that authorization remains valid throughout a TTL.

## Public compatibility and migration guidance

The [HTTP endpoint guide](../api-reference/mcp-http.mdx) and
[Chinese version](../zh/api-reference/mcp-http.mdx) describe the current
compatibility matrix and client migration steps. The step 2 boundary above
records the intermediate migration stage; modern downstream HTTP is now enabled,
while upstream clients retain legacy negotiation.

Legacy HTTP+SSE is documented as deprecated, with no announced removal release
or date. Its removal requires a published schedule respecting the planned
at-least-12-month window and a verified client migration path. Legacy
`2025-11-25` Streamable HTTP sessions remain supported independently of SSE
transport deprecation.

Compatibility coverage is maintained in these suites:

| Boundary                                                                                                                                                                                   | Coverage                                               |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Legacy SSE and v1 HTTP; modern discovery without sessions; routing-header validation and bearer rejection; route-bound explicit state; resource cache hints; per-request Apps capabilities | `tests/integration/sse-service-real-client.test.ts`    |
| Explicit-state credential/handle isolation, invalid and anonymous handles, idle expiry, active-call pinning and OpenAPI cookie cleanup                                                     | `tests/services/mcpService-per-session-client.test.ts` |
| Caller capability filtering, single/multi-server Apps routing, metadata preservation, modern cache hints and legacy read behavior                                                          | `tests/services/mcpService-apps.test.ts`               |

These suites cover the documented gateway behavior; they are not a certification
of every client implementation or every optional MCP feature.
