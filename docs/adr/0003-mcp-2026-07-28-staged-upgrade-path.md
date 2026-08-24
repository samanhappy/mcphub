# Adopt MCP 2026-07-28 through a staged upgrade path

MCPHub adopts the MCP `2026-07-28` specification (stateless core: no `initialize` handshake, no `Mcp-Session-Id`) in three decoupled steps instead of a single migration:

1. **OAuth hardening on the current SDK** (no wire change): add RFC 9207 `iss` to our authorization server's authorize responses (`oauthServerController.ts` builds redirects with only `code`/`state` today) and validate `iss` when redeeming codes as an upstream OAuth client; add Client ID Metadata Documents (CIMD) alongside Dynamic Client Registration — DCR is formally deprecated in the new revision but keeps working.
2. **SDK v2 API migration, wire unchanged**: move from the monolithic `@modelcontextprotocol/sdk` (currently ^1.29.0, negotiating `2025-11-25`) to the v2 split packages (`@modelcontextprotocol/server`, `/client`, HTTP adapters), using the official codemod. Servers keep speaking `2025-11-25` until step 3.
3. **Protocol enablement via dual-stack handler**: serve both revisions from one endpoint with v2's `createMcpHandler`, run a deprecation window on the legacy SSE transport, then remove the session layer.

The path's shape comes from what the code actually binds to sessions. Most downstream state is derivable: the `enableSessionRebuild` mechanism already reconstructs full sessions from `(sessionId, group)` alone, per-session `Server` instances (`mcpService.ts`) are pure functions of group, and bearer auth is revalidated on every request. Two pieces are genuinely sticky and block step 3: `perSessionClient` upstream isolation plus OpenAPI per-session cookie jars (need an explicit-handle or header-correlation redesign), and the legacy SSE `/messages` endpoint whose group lives only in the session (dies with the transport). We use no sampling/elicitation/roots anywhere, so Multi Round-Trip Requests require zero migration.

## Considered Options

- **Big-bang move to v2 + new protocol now** — rejected: v2 GA'd weeks ago; bundling the transport/session rewrite (~700 lines of session tests plus integration tests encoding session-continuity semantics) with independently valuable OAuth fixes maximizes risk on both.
- **Stay on `2025-11-25` indefinitely** — rejected: the stateless core targets exactly gateway deployments like ours; staying means keeping the session-rebuild workaround layer forever and forgoing header-based routing (`Mcp-Method`/`Mcp-Name`) and list-cache (`ttlMs`/`cacheScope`) passthrough.
- **Gate all work on client ecosystem readiness** — rejected as a blocker: `createMcpHandler` answers both revisions from one endpoint, so old clients keep working throughout; the only real gate is letting early v2 patch releases prove stable before step 2.

## Consequences

- Step 2 drops Node 18 from the support matrix (v2 is ESM-only, Node 20+): update `engines`, CI matrix, and Docker base image together.
- The legacy HTTP+SSE transport carries a ≥12-month deprecation window per spec policy; its removal takes the group-in-session quirk and the session-rebuild machinery with it.
- `perSessionClient` isolation must gain an explicit design (tool-minted handles passed as arguments, per the spec's recommended pattern, or a header correlation key) before the session layer can be deleted.
- During the dual-stack period, the group-resolution fallback chain must preserve the GHSA-454m-4vm6-842f scope-validation behavior for requests arriving under either revision.
- Session-continuity tests (cached-session-id reuse after rebuild, initialize-gated session creation) are rewritten at step 3, not patched beforehand.
